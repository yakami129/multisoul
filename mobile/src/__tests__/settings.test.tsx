import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { Alert } from 'react-native';
import SettingsScreen from '../../app/(tabs)/settings';
import { clearDiagnosticsEntries, recordDiagnosticsEvent } from '../services/diagnosticsLog';
import { useEndpointStore } from '../store/endpointStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

// Mock expo-camera used by AddEndpointModal
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [null, jest.fn()],
}));

// Mock endpointClient to avoid axios/fetch stream errors in test env
jest.mock('../api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
  clearEndpointClients: jest.fn(),
}));

class MockReleaseLogWebSocket {
  static instances: MockReleaseLogWebSocket[] = [];
  static OPEN = 1;
  url: string;
  readyState = MockReleaseLogWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  close = jest.fn(() => {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  });

  constructor(url: string) {
    this.url = url;
    MockReleaseLogWebSocket.instances.push(this);
  }

  emit(data: string) {
    this.onmessage?.({ data });
  }

  emitErrorThenClose(code: number) {
    this.onerror?.();
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

global.WebSocket = MockReleaseLogWebSocket as unknown as typeof WebSocket;

/// Settings screen: renders endpoint list and add button
///
/// Execution:
///   1. Seed endpointStore with one endpoint
///   2. Render SettingsScreen
///
/// Expected:
///   - SETTINGS nav title visible
///   - ENDPOINTS section label visible
///   - Seeded endpoint label visible
describe('SettingsScreen', () => {
  beforeEach(async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (Clipboard.setStringAsync as jest.Mock).mockClear();
    MockReleaseLogWebSocket.instances = [];
    await clearDiagnosticsEntries();
    useEndpointStore.setState({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Home Server',
          base_url: 'http://192.168.1.1:8765',
          token: 'tok',
          last_seen_at: null,
        },
        {
          id: 'ep-2',
          label: 'Mac Mini',
          base_url: 'http://10.0.0.2:8765',
          token: 'tok two',
          last_seen_at: null,
        },
      ],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    act(() => {
      useEndpointStore.setState({ endpoints: [] });
    });
  });

  it('renders settings screen with endpoint list', () => {
    render(<SettingsScreen />);

    expect(screen.getByText('SETTINGS')).toBeTruthy();
    expect(screen.getByText('ENDPOINTS')).toBeTruthy();
    expect(screen.getByText('Home Server')).toBeTruthy();
  });

  it('shows empty state when no endpoints configured', () => {
    useEndpointStore.setState({ endpoints: [] });

    render(<SettingsScreen />);

    expect(screen.getByText('NO ENDPOINTS CONFIGURED')).toBeTruthy();
  });

  /// Settings diagnostics: release logs modal streams formatted msctl text for the selected endpoint
  ///
  /// Data construction:
  ///   endpoints         = Home Server + Mac Mini
  ///   selected endpoint = Mac Mini（token 含空格，用于验证 query encode）
  ///   websocket line    = "2026-05-24T10:00:00 INFO  [serve] http_request status=200"
  ///
  /// Execution:
  ///   1. Render SettingsScreen
  ///   2. Press Release logs to open the modal
  ///   3. Select Mac Mini
  ///   4. Emit one plain text websocket message
  ///
  /// Expected:
  ///   - positive assertion: modal shows endpoint choices
  ///   - positive assertion: websocket URL points at /ws/logs with encoded token
  ///   - positive assertion: formatted msctl text appears as-is
  ///   - negative assertion: rendered text is not JSON envelope content
  it('opens release logs modal and streams selected endpoint text', async () => {
    render(<SettingsScreen />);

    expect(screen.getByText('DIAGNOSTICS')).toBeTruthy();

    fireEvent.press(screen.getByTestId('release-logs-open-btn'));
    expect(screen.getAllByText('Release logs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mac Mini').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByTestId('release-logs-endpoint-ep-2'));

    await waitFor(() => {
      expect(MockReleaseLogWebSocket.instances.length).toBe(1);
    });
    expect(MockReleaseLogWebSocket.instances[0]?.url).toBe(
      'ws://10.0.0.2:8765/ws/logs?token=tok%20two&tail=200&level=trace',
    );

    act(() => {
      MockReleaseLogWebSocket.instances[0]?.emit(
        '2026-05-24T10:00:00 INFO  [serve] http_request status=200',
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('release-logs-text').props.children).toContain('http_request');
    });
    expect(screen.getByTestId('release-logs-text').props.children).not.toContain('{"type":"log"');
  });

  /// Settings diagnostics: copy exports combined msctl and iOS release logs as plain text
  ///
  /// Data construction:
  ///   diagnostics entry = warn / chat.image / "image load failed"
  ///   websocket line    = "2026-05-24T10:00:01 WARN  [uploads] image_failed status=404"
  ///   copied payload    = modal text buffer = iOS diagnostics + msctl websocket text
  ///
  /// Execution:
  ///   1. Seed one iOS diagnostics event before rendering SettingsScreen
  ///   2. Open Release logs modal and select Home Server
  ///   3. Emit one formatted msctl text line
  ///   4. Press Copy logs inside the modal
  ///
  /// Expected:
  ///   - positive assertion: Clipboard receives iOS diagnostics text
  ///   - positive assertion: Clipboard receives msctl formatted text
  ///   - negative assertion: Clipboard does not receive JSON envelope text
  ///   - negative assertion: placeholder-only "No diagnostics yet." is not copied
  it('copies combined release logs as plain text', async () => {
    recordDiagnosticsEvent('warn', 'chat.image', 'image load failed', { file_id: 'file-1.jpg' });

    render(<SettingsScreen />);

    fireEvent.press(screen.getByTestId('release-logs-open-btn'));
    fireEvent.press(screen.getByTestId('release-logs-endpoint-ep-1'));

    await waitFor(() => {
      expect(MockReleaseLogWebSocket.instances.length).toBe(1);
    });
    act(() => {
      MockReleaseLogWebSocket.instances[0]?.emit(
        '2026-05-24T10:00:01 WARN  [uploads] image_failed status=404',
      );
    });

    fireEvent.press(screen.getByTestId('release-logs-copy-btn'));

    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('chat.image'));
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('image_failed'));
    expect(Clipboard.setStringAsync).not.toHaveBeenCalledWith(expect.stringContaining('{"type"'));
    expect(Clipboard.setStringAsync).not.toHaveBeenCalledWith('No diagnostics yet.');
  });

  /// Settings diagnostics: websocket error status is not overwritten by the close event
  ///
  /// Data construction:
  ///   selected endpoint = Home Server
  ///   websocket error   = synthetic error followed by close code 1006
  ///   msctl lines       = 0 lines
  ///
  /// Execution:
  ///   1. Open Release logs modal
  ///   2. Select Home Server
  ///   3. Emit websocket error, then close
  ///
  /// Expected:
  ///   - positive assertion: status shows "Could not stream logs"
  ///   - negative assertion: status is not overwritten by generic "Log stream closed."
  it('keeps websocket error status when close follows error', async () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByTestId('release-logs-open-btn'));
    fireEvent.press(screen.getByTestId('release-logs-endpoint-ep-1'));

    await waitFor(() => {
      expect(MockReleaseLogWebSocket.instances.length).toBe(1);
    });

    act(() => {
      MockReleaseLogWebSocket.instances[0]?.emitErrorThenClose(1006);
    });

    expect(screen.getByText('Could not stream logs from Home Server.')).toBeTruthy();
    expect(screen.queryByText('Log stream closed.')).toBeNull();
  });
});

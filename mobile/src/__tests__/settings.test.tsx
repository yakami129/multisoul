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

  /// Settings diagnostics: copy button exports release logs
  ///
  /// Data construction:
  ///   diagnostics entry = warn / chat.image / "image load failed"
  ///   endpoint count    = 1 existing endpoint
  ///   copied payload    = formatted diagnostics text from diagnosticsLog
  ///
  /// Execution:
  ///   1. Seed one diagnostics event before rendering SettingsScreen
  ///   2. Render SettingsScreen
  ///   3. Press Copy logs
  ///
  /// Expected:
  ///   - positive assertion: DIAGNOSTICS section is visible in release UI
  ///   - positive assertion: Clipboard receives the chat.image log
  ///   - negative assertion: placeholder-only "No diagnostics yet." is not copied
  it('copies diagnostics logs from settings', async () => {
    recordDiagnosticsEvent('warn', 'chat.image', 'image load failed', { file_id: 'file-1.jpg' });

    render(<SettingsScreen />);

    expect(screen.getByText('DIAGNOSTICS')).toBeTruthy();

    fireEvent.press(screen.getByTestId('diagnostics-copy-btn'));

    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('chat.image'));
    });
    expect(Clipboard.setStringAsync).not.toHaveBeenCalledWith('No diagnostics yet.');
  });
});

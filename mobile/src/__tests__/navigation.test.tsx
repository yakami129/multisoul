import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import fs from 'fs';
import path from 'path';
import type React from 'react';
import { Alert } from 'react-native';
import TabLayout, {
  TAB_BAR_HEIGHT,
  TAB_BAR_SAFE_AREA_BOTTOM,
  tabScreenOptions,
} from '../../app/(tabs)/_layout';
import { clearDiagnosticsEntries, recordDiagnosticsEvent } from '../services/diagnosticsLog';
import { useEndpointStore } from '../store/endpointStore';

jest.mock('expo-router', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');

  function Tabs({ children }: any) {
    const screens = React.Children.toArray(children).map((child: any) => ({
      name: child.props.name,
      title: child.props.options?.title ?? child.props.name,
      listeners: child.props.listeners,
    }));
    const [tab, setTab] = React.useState('index');
    return (
      <View>
        <View testID="tab-bar">
          {screens.map((screen: { name: string; title: string; listeners?: any }) => (
            <TouchableOpacity
              key={screen.name}
              testID={`tab-${screen.name}`}
              onPress={() => setTab(screen.name)}
              onLongPress={() => {
                const listeners =
                  typeof screen.listeners === 'function'
                    ? screen.listeners({ navigation: {}, route: { name: screen.name } })
                    : screen.listeners;
                listeners?.tabLongPress?.({ navigation: {}, route: { name: screen.name } });
              }}
            >
              <Text>{screen.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text testID="active-tab">{tab}</Text>
      </View>
    );
  }

  Tabs.Screen = () => null;

  return {
    Tabs,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useLocalSearchParams: () => ({}),
  };
});

jest.mock('lucide-react-native', () => {
  const { Text } = require('react-native');

  return {
    Activity: ({ color }: { color: string }) => <Text>{`Activity ${color}`}</Text>,
    FileText: ({ color }: { color: string }) => <Text>{`FileText ${color}`}</Text>,
    Inbox: ({ color }: { color: string }) => <Text>{`Inbox ${color}`}</Text>,
    Layers: ({ color }: { color: string }) => <Text>{`Layers ${color}`}</Text>,
    LayoutGrid: ({ color }: { color: string }) => <Text>{`LayoutGrid ${color}`}</Text>,
    Settings: ({ color }: { color: string }) => <Text>{`Settings ${color}`}</Text>,
  };
});

jest.mock('../../src/api', () => ({
  getApiClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue({ data: [] }),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function openReleaseLogsFromSettingsTab() {
  await act(async () => {
    fireEvent(screen.getByTestId('tab-settings'), 'longPress');
  });
}

/// Tab navigation: Agents, Specs, Activity, Workflows, and Settings tabs are accessible
///
/// Execution:
///   1. Render TabLayout
///   2. Verify new tab labels visible
///   3. Verify old global tab labels hidden
///   4. Press Activity tab
///   5. Verify Activity tab active
///
/// Expected:
///   - 'Agents' tab label visible
///   - 'Specs' tab label visible
///   - 'Activity' tab label visible
///   - 'Workflows' and 'Settings' tab labels visible
///   - 'Projects', 'Chat', and 'Inbox' tab labels hidden
describe('Tab navigation', () => {
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
          base_url: 'http://10.0.0.2:8765/',
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

  it('renders only the public app tabs', () => {
    render(<TabLayout />, { wrapper });
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('Specs')).toBeTruthy();
    expect(screen.getByText('Activity')).toBeTruthy();
    expect(screen.getByText('Workflows')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();

    expect(screen.queryByText('Projects')).toBeNull();
    expect(screen.queryByText('Chat')).toBeNull();
    expect(screen.queryByText('Inbox')).toBeNull();
  });

  it('keeps stylesheets out of the tabs route directory', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/(tabs)/settings.styles.ts'))).toBe(false);
  });

  it('switches to Activity tab on press', () => {
    render(<TabLayout />, { wrapper });
    fireEvent.press(screen.getByTestId('tab-activity'));
    expect(screen.getByTestId('active-tab').props.children).toBe('activity');
  });

  /// Settings tab diagnostics: long-press opens release logs without changing normal tab press
  ///
  /// Data construction:
  ///   endpoints = Home Server + Mac Mini seeded into endpointStore
  ///   active tab starts as "index"
  ///
  /// Execution:
  ///   1. Render TabLayout
  ///   2. Long-press Settings tab
  ///
  /// Expected:
  ///   - Positive: Release logs modal title appears
  ///   - Positive: endpoint choices appear inside the modal
  ///   - Negative: active tab remains index because long-press is a diagnostics shortcut
  it('opens release logs from a Settings tab long press', async () => {
    render(<TabLayout />, { wrapper });

    await openReleaseLogsFromSettingsTab();

    expect(screen.getByText('Release logs')).toBeTruthy();
    expect(screen.getAllByText('Mac Mini').length).toBeGreaterThan(0);
    expect(screen.getByTestId('active-tab').props.children).toBe('index');
  });

  /// Settings tab diagnostics: release logs modal streams formatted msctl text
  ///
  /// Data construction:
  ///   endpoints         = Home Server + Mac Mini
  ///   selected endpoint = Mac Mini（token 含空格，用于验证 query encode）
  ///   websocket line    = "2026-05-24T10:00:00 INFO  [serve] http_request status=200"
  ///
  /// Execution:
  ///   1. Render TabLayout
  ///   2. Long-press Settings tab to open the modal
  ///   3. Select Mac Mini
  ///   4. Emit one plain text websocket message
  ///
  /// Expected:
  ///   - Positive: websocket URL points at /ws/logs with encoded token
  ///   - Positive: formatted msctl text appears as-is
  ///   - Negative: rendered text is not JSON envelope content
  it('streams selected endpoint release logs after Settings tab long press', async () => {
    render(<TabLayout />, { wrapper });

    await openReleaseLogsFromSettingsTab();
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

  /// Settings tab diagnostics: copy exports combined msctl and iOS release logs as plain text
  ///
  /// Data construction:
  ///   diagnostics entry = warn / chat.image / "image load failed"
  ///   websocket line    = "2026-05-24T10:00:01 WARN  [uploads] image_failed status=404"
  ///   copied payload    = modal text buffer = iOS diagnostics + msctl websocket text
  ///
  /// Execution:
  ///   1. Seed one iOS diagnostics event before rendering TabLayout
  ///   2. Long-press Settings tab and select Home Server
  ///   3. Emit one formatted msctl text line
  ///   4. Press Copy logs inside the modal
  ///
  /// Expected:
  ///   - Positive: Clipboard receives iOS diagnostics text
  ///   - Positive: Clipboard receives msctl formatted text
  ///   - Negative: Clipboard does not receive JSON envelope text
  ///   - Negative: placeholder-only "No diagnostics yet." is not copied
  it('copies combined release logs after Settings tab long press', async () => {
    recordDiagnosticsEvent('warn', 'chat.image', 'image load failed', { file_id: 'file-1.jpg' });
    render(<TabLayout />, { wrapper });

    await openReleaseLogsFromSettingsTab();
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

  /// Settings tab diagnostics: websocket error status is not overwritten by the close event
  ///
  /// Data construction:
  ///   selected endpoint = Home Server
  ///   websocket error   = synthetic error followed by close code 1006
  ///   msctl lines       = 0 lines
  ///
  /// Execution:
  ///   1. Long-press Settings tab to open Release logs modal
  ///   2. Select Home Server
  ///   3. Emit websocket error, then close
  ///
  /// Expected:
  ///   - Positive: status shows "Could not stream logs"
  ///   - Negative: status is not overwritten by generic "Log stream closed."
  it('keeps websocket error status when close follows error after Settings tab long press', async () => {
    render(<TabLayout />, { wrapper });

    await openReleaseLogsFromSettingsTab();
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

  /// iOS tab bar labels: safe-area padding must not consume the 62px content rail
  ///
  /// Data construction:
  ///   visible rail = 62px, matching mobile/docs/design.md §6.1
  ///   iOS home indicator inset = 34px, matching the previous hard-coded marginBottom
  ///   total height must be 62 + 34 = 96px so labels keep their own vertical space
  ///
  /// Execution:
  ///   1. Read the exported tab screen options used by expo-router Tabs
  ///   2. Flatten the tabBarStyle configuration
  ///   3. Compare height and label-position choices against the iOS-safe layout contract
  ///
  /// Expected:
  ///   - tab bar height includes bottom safe-area space, so label text is not clipped
  ///   - no hard-coded marginBottom remains, so safe-area is not double-counted
  ///   - labels stay below icons, matching the product design
  it('keeps iOS tab labels visible above the home indicator inset', () => {
    const style = tabScreenOptions.tabBarStyle;

    expect(TAB_BAR_HEIGHT).toBe(62, 'visible tab rail should remain the documented 62px');
    expect(TAB_BAR_SAFE_AREA_BOTTOM).toBe(
      34,
      'bottom inset should preserve the iOS home indicator area',
    );
    expect(style.height).toBe(
      96,
      'tabBarStyle.height should be 62 + 34 so iOS safe-area padding does not clip labels',
    );
    expect(style.marginBottom).toBe(
      undefined,
      'tabBarStyle.marginBottom should not hard-code the same iOS inset outside the tab bar',
    );
    expect(tabScreenOptions.tabBarLabelPosition).toBe(
      'below-icon',
      'tab labels should render below icons instead of being auto-positioned away',
    );
    expect(tabScreenOptions.tabBarShowLabel).toBe(true, 'tab labels should be explicitly enabled');
  });

  /// Brand refresh tab rail: bottom navigation uses the black floating capsule.
  ///
  /// Data construction:
  ///   Target source = brand refresh prototype:
  ///     background #0D0D0D, no divider, active white, inactive soft white, label size 11
  ///
  /// Execution:
  ///   1. Read exported tabScreenOptions.
  ///   2. Compare surface, divider, tint, and label sizing values.
  ///
  /// Expected:
  ///   - Positive: tab rail matches the brand refresh visual tokens.
  ///   - Negative: the old orange pencli tab state does not remain.
  it('matches the brand refresh floating tab rail tokens', () => {
    expect({
      actual: tabScreenOptions.tabBarStyle.backgroundColor,
      reason: 'tab rail should use the brand refresh ink capsule',
    }).toEqual({
      actual: '#0D0D0D',
      reason: 'tab rail should use the brand refresh ink capsule',
    });
    expect({
      actual: tabScreenOptions.tabBarStyle.borderTopWidth,
      reason: 'floating tab rail should not draw a top divider',
    }).toEqual({
      actual: 0,
      reason: 'floating tab rail should not draw a top divider',
    });
    expect({
      actual: tabScreenOptions.tabBarActiveTintColor,
      reason: 'active tab text should use white on the ink capsule',
    }).toEqual({
      actual: '#FFFFFF',
      reason: 'active tab text should use white on the ink capsule',
    });
    expect({
      actual: tabScreenOptions.tabBarInactiveTintColor,
      reason: 'inactive tab icons should use soft white',
    }).toEqual({
      actual: 'rgba(255, 255, 255, 0.70)',
      reason: 'inactive tab icons should use soft white',
    });
    expect({
      actual: tabScreenOptions.tabBarLabelStyle.fontSize,
      reason: 'tab labels should match the brand refresh caption size',
    }).toEqual({
      actual: 11,
      reason: 'tab labels should match the brand refresh caption size',
    });
  });
});

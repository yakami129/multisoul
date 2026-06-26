import fs from 'fs';
import path from 'path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import type React from 'react';
import { Alert } from 'react-native';
import TabLayout, {
  ACTIVE_ICON_IMAGE_SIZE,
  ACTIVE_ICON_TRAY_SIZE,
  INACTIVE_ICON_SIZE,
  TAB_BAR_HEIGHT,
  TAB_BAR_SAFE_AREA_BOTTOM,
  TAB_BAR_SHOW_ACTIVE_LABEL,
  TAB_ITEM_FLEX,
  TAB_ITEM_GAP,
  TAB_ROUTE_ICON_KEYS,
  tabScreenOptions,
} from '../../app/(tabs)/_layout';
import i18n from '../i18n';
import { clearDiagnosticsEntries, recordDiagnosticsEvent } from '../services/diagnosticsLog';
import { useEndpointStore } from '../store/endpointStore';

jest.mock('expo-router', () => {
  const React = require('react');
  const { View, Text } = require('react-native');

  function Tabs({ children, screenOptions = {}, tabBar }: any) {
    const screens = React.Children.toArray(children).map((child: any) => ({
      name: child.props.name,
      title: child.props.options?.title ?? child.props.name,
      href: child.props.options?.href,
      options: child.props.options ?? {},
      listeners: child.props.listeners,
    }));
    const [tab, setTab] = React.useState('index');
    const routes = screens.map((screen: { name: string }) => ({
      key: `${screen.name}-key`,
      name: screen.name,
      params: undefined,
    }));
    const descriptors = routes.reduce((acc: any, route: { key: string; name: string }) => {
      const screen = screens.find((candidate: { name: string }) => candidate.name === route.name);
      acc[route.key] = {
        options: {
          ...screenOptions,
          ...screen?.options,
          title: screen?.title ?? route.name,
        },
      };
      return acc;
    }, {});
    const navigation = {
      emit: (event: { type: string; target?: string }) => {
        const route = routes.find((candidate: { key: string }) => candidate.key === event.target);
        const screen = screens.find(
          (candidate: { name: string }) => candidate.name === route?.name,
        );
        const listeners =
          typeof screen?.listeners === 'function'
            ? screen.listeners({ navigation: {}, route })
            : screen?.listeners;
        if (event.type === 'tabLongPress') {
          listeners?.tabLongPress?.({ navigation: {}, route });
        }
        return { defaultPrevented: false };
      },
      navigate: (name: string) => setTab(name),
    };
    const customTabBar = tabBar({
      state: {
        index: routes.findIndex((route: { name: string }) => route.name === tab),
        routes,
      },
      descriptors,
      navigation,
    });

    return (
      <View>
        <Text testID="registered-tabs">
          {screens.map((screen: { name: string }) => screen.name)}
        </Text>
        {customTabBar}
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
    MessageCircle: ({ color }: { color: string }) => <Text>{`MessageCircle ${color}`}</Text>,
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

/// Tab navigation: 中文 tab 文案保持现有信息架构，workflows 仍只注册不展示
///
/// Execution:
///   1. Render TabLayout
///   2. Verify current Chinese tab labels are preserved on visible tab buttons
///   3. Verify old global tab labels hidden
///   4. Press Activity tab
///   5. Verify Activity tab active
///
/// Expected:
///   - '智能体' tab label is kept as the Agent tab accessibility label
///   - '规格' tab label is kept as the Specs tab accessibility label
///   - '动态' tab label is kept as the Activity tab accessibility label
///   - '设置' tab label is kept as the Settings tab accessibility label
///   - 'Workflows' route registered but hidden from the tab rail
///   - 'Projects', 'Chat', and 'Inbox' tab labels hidden
describe('Tab navigation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh');
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
    expect(screen.getByTestId('tab-index').props.accessibilityLabel).toBe('项目');
    expect(screen.getByTestId('tab-specs').props.accessibilityLabel).toBe('规格');
    expect(screen.getByTestId('tab-activity').props.accessibilityLabel).toBe('动态');
    expect(screen.getByTestId('tab-settings').props.accessibilityLabel).toBe('设置');
    expect(screen.queryByText('Workflows')).toBeNull();
    expect(screen.getByTestId('registered-tabs').props.children).toContain('workflows');

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

  /// iOS tab bar capsule: safe-area 留白必须在黑色胶囊外部
  ///
  /// Data construction:
  ///   visible capsule = 58px，匹配目标图的短胶囊
  ///   iOS bottom gap = 16px，用作胶囊外部悬浮距离
  ///   total black height must stay 58px；safe-area 不进入黑色区域
  ///
  /// Execution:
  ///   1. Read the exported tab screen options used by expo-router Tabs
  ///   2. Flatten the tabBarStyle configuration
  ///   3. Compare height and bottom placement against the custom floating contract
  ///
  /// Expected:
  ///   - Positive: visual capsule height is 58px
  ///   - Positive: bottom offset remains outside the capsule
  ///   - Negative: capsule height no longer equals 72 + safe-area
  it('keeps the black capsule separate from the iOS bottom safe area', () => {
    const style = tabScreenOptions.tabBarStyle;

    expect(TAB_BAR_HEIGHT).toBe(58, 'visible black capsule should be 58px tall');
    expect(TAB_BAR_SAFE_AREA_BOTTOM).toBe(
      16,
      'bottom inset should sit outside the black capsule as floating room',
    );
    expect(style.height).toBe(
      58,
      'tabBarStyle.height should describe only the black capsule, not capsule + safe-area',
    );
    expect(style.bottom).toBe(
      16,
      'tabBarStyle.bottom should keep the capsule lifted above the device edge',
    );
    expect(style.paddingBottom).toBe(
      0,
      'black capsule must not add safe-area padding inside itself',
    );
  });

  /// Brand refresh tab rail: active 为紧凑 icon-only column，inactive 为图标上/标题下
  ///
  /// Data: initial index active；specs 文案仍为「规格」，icon key = iconChat。
  /// Execution: render → inspect active/inactive IDs → press Activity。
  /// Expected: active label hidden；active/inactive share the same slot width；inactive column shows labels below icons。
  it('renders target-style active and inactive tab layouts', () => {
    render(<TabLayout />, { wrapper });

    expect(TAB_BAR_SHOW_ACTIVE_LABEL).toBe(false);
    expect(TAB_ITEM_FLEX).toBe(1);
    expect(screen.getByTestId('bottom-tab-index-active-column')).toBeTruthy();
    expect(screen.queryByTestId('bottom-tab-index-active-label')).toBeNull();
    expect(screen.queryByTestId('bottom-tab-index-active-row')).toBeNull();
    expect(screen.queryByTestId('bottom-tab-index-inactive-column')).toBeNull();
    expect(screen.getByTestId('bottom-tab-specs-inactive-column')).toBeTruthy();
    expect(screen.getByText('规格')).toBeTruthy();
    expect(screen.queryByText('项目')).toBeNull();
    expect(TAB_ROUTE_ICON_KEYS.specs).toBe('iconChat');
    expect(TAB_ROUTE_ICON_KEYS.specs).not.toBe('iconAgent');

    fireEvent.press(screen.getByTestId('tab-activity'));

    expect(screen.getByTestId('bottom-tab-activity-active-column')).toBeTruthy();
    expect(screen.queryByTestId('bottom-tab-activity-active-label')).toBeNull();
    expect(screen.getByTestId('bottom-tab-index-inactive-column')).toBeTruthy();
    expect(screen.getByText('项目')).toBeTruthy();
    expect(screen.queryByText('动态')).toBeNull();
  });

  /// Brand refresh tab rail: bottom navigation uses the black floating capsule.
  ///
  /// Data: target tokens include 46px active tray；icons shrink to 70% = active 34*0.7≈24, inactive 28*0.7≈20。
  /// Execution: read exported tabScreenOptions and exported icon constants。
  /// Expected: target token bundle matches；old orange/default tab state does not remain。
  it('matches the brand refresh floating tab rail tokens', () => {
    expect({
      activeTint: tabScreenOptions.tabBarActiveTintColor,
      activeIconImageSize: ACTIVE_ICON_IMAGE_SIZE,
      activeTraySize: ACTIVE_ICON_TRAY_SIZE,
      backgroundColor: tabScreenOptions.tabBarStyle.backgroundColor,
      borderTopWidth: tabScreenOptions.tabBarStyle.borderTopWidth,
      inactiveIconSize: INACTIVE_ICON_SIZE,
      inactiveTint: tabScreenOptions.tabBarInactiveTintColor,
      itemFlex: TAB_ITEM_FLEX,
      itemGap: TAB_ITEM_GAP,
      labelFontSize: tabScreenOptions.tabBarLabelStyle.fontSize,
      reason: 'tab rail visual tokens should match the target capsule',
    }).toEqual({
      activeTint: '#00E5FF',
      activeIconImageSize: 24,
      activeTraySize: 46,
      backgroundColor: '#0D0D0D',
      borderTopWidth: 0,
      inactiveIconSize: 20,
      inactiveTint: 'rgba(255, 255, 255, 0.70)',
      itemFlex: 1,
      itemGap: 30,
      labelFontSize: 11,
      reason: 'tab rail visual tokens should match the target capsule',
    });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
// eslint-disable-next-line import/order
import type React from 'react';
jest.mock('expo-router', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');

  function Tabs({ children }: any) {
    const screens = React.Children.toArray(children).map((child: any) => ({
      name: child.props.name,
      title: child.props.options?.title ?? child.props.name,
    }));
    const [tab, setTab] = React.useState('index');
    return (
      <View>
        <View testID="tab-bar">
          {screens.map((screen: { name: string; title: string }) => (
            <TouchableOpacity
              key={screen.name}
              testID={`tab-${screen.name}`}
              onPress={() => setTab(screen.name)}
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
  const React = require('react');
  const { Text } = require('react-native');

  return {
    Inbox: ({ color }: { color: string }) => <Text>{`Inbox ${color}`}</Text>,
    Layers: ({ color }: { color: string }) => <Text>{`Layers ${color}`}</Text>,
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

import TabLayout, {
  TAB_BAR_HEIGHT,
  TAB_BAR_SAFE_AREA_BOTTOM,
  tabScreenOptions,
} from '../../app/(tabs)/_layout';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/// Tab navigation: Projects, Activity, and Settings tabs are accessible
///
/// Execution:
///   1. Render TabLayout
///   2. Verify new tab labels visible
///   3. Verify old global tab labels hidden
///   4. Press Activity tab
///   5. Verify Activity tab active
///
/// Expected:
///   - 'Projects' tab label visible
///   - 'Activity' tab label visible
///   - 'Settings' tab label visible
///   - 'Agents', 'Chat', and 'Inbox' tab labels hidden
describe('Tab navigation', () => {
  it('renders only Projects, Activity, and Settings tabs', () => {
    render(<TabLayout />, { wrapper });
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Activity')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();

    expect(screen.queryByText('Agents')).toBeNull();
    expect(screen.queryByText('Chat')).toBeNull();
    expect(screen.queryByText('Inbox')).toBeNull();
  });

  it('switches to Activity tab on press', () => {
    render(<TabLayout />, { wrapper });
    fireEvent.press(screen.getByTestId('tab-activity'));
    expect(screen.getByTestId('active-tab').props.children).toBe('activity');
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
});

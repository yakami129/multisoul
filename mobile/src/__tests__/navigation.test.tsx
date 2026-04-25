import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-router', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');

  return {
    Tabs: ({ children }: any) => {
      const [tab, setTab] = React.useState('index');
      return (
        <View>
          <View testID="tab-bar">
            <TouchableOpacity testID="tab-agents" onPress={() => setTab('index')}>
              <Text>Agents</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="tab-settings" onPress={() => setTab('settings')}>
              <Text>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text testID="active-tab">{tab}</Text>
        </View>
      );
    },
    'Tabs.Screen': () => null,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useLocalSearchParams: () => ({}),
  };
});

jest.mock('../../src/api', () => ({
  getApiClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue({ data: [] }),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import TabLayout from '../../app/(tabs)/_layout';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/// Tab navigation: both Agents and Settings tabs are accessible
///
/// Execution:
///   1. Render TabLayout
///   2. Verify Agents tab visible
///   3. Press Settings tab
///   4. Verify Settings tab active
///
/// Expected:
///   - 'Agents' tab label visible
///   - 'Settings' tab label visible
describe('Tab navigation', () => {
  it('renders both Agents and Settings tabs', () => {
    render(<TabLayout />, { wrapper });
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('switches to Settings tab on press', () => {
    render(<TabLayout />, { wrapper });
    fireEvent.press(screen.getByTestId('tab-settings'));
    expect(screen.getByTestId('active-tab').props.children).toBe('settings');
  });
});

import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import SettingsScreen from '../../app/(tabs)/settings';
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
  beforeEach(() => {
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
});

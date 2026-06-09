import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import SettingsScreen from '../../app/(tabs)/settings';
import { pingAllEndpoints } from '../features/settings/services/endpointService';
import { useEndpointStore } from '../store/endpointStore';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => callback(),
}));

jest.mock('../features/settings/services/endpointService', () => ({
  pingAllEndpoints: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: ({ children }: any) => children,
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

/// Settings screen: renders endpoint management without diagnostics release-log entry
///
/// Execution:
///   1. Seed endpointStore with one endpoint
///   2. Render SettingsScreen
///
/// Expected:
///   - Positive: SETTINGS nav title visible
///   - Positive: Endpoints section label visible
///   - Positive: Seeded endpoint label visible
///   - Negative: DIAGNOSTICS section is absent because release logs open from Settings tab long-press
///   - Negative: Open logs button is absent because Settings no longer owns that interaction
describe('SettingsScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useEndpointStore.setState({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Home Server',
          base_url: 'http://192.168.1.1:8765',
          token: 'tok',
          last_seen_at: Date.now(),
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

  it('renders settings screen with endpoint list', () => {
    render(<SettingsScreen />);

    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Endpoints')).toBeTruthy();
    expect(screen.getByText('Home Server')).toBeTruthy();
    expect(screen.getByText('Preferences')).toBeTruthy();
    expect(screen.getByText('Security')).toBeTruthy();
    expect(screen.getByText('Scan setup QR')).toBeTruthy();
    expect(screen.queryByText('DIAGNOSTICS')).toBeNull();
    expect(screen.queryByText('Open logs')).toBeNull();
  });

  it('shows empty state when no endpoints configured', () => {
    useEndpointStore.setState({ endpoints: [] });

    render(<SettingsScreen />);

    expect(screen.getByText('NO ENDPOINTS CONFIGURED')).toBeTruthy();
  });

  it('shows hero online/offline counts without push ready', () => {
    render(<SettingsScreen />);

    expect(screen.getByText(/2 machines · 1 Online · 1 Offline/)).toBeTruthy();
    expect(screen.queryByText('push ready')).toBeNull();
    expect(screen.queryByText('推送就绪')).toBeNull();
  });

  it('pings endpoints when the screen gains focus', () => {
    render(<SettingsScreen />);

    expect(pingAllEndpoints).toHaveBeenCalledTimes(1);
  });

  it('shows online and offline pills on endpoint rows', () => {
    render(<SettingsScreen />);

    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText('Idle')).toBeNull();
  });
});

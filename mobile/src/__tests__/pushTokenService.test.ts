import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { getEndpointClient } from '@/api/endpointClient';
import { registerPushTokenForEndpoints } from '@/services/pushTokenService';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        eas: {
          projectId: '3555d4e1-4ac3-4e0c-9816-4383af1872e9',
        },
      },
    },
  },
}));

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(),
}));

const mockGetEndpointClient = getEndpointClient as jest.MockedFunction<typeof getEndpointClient>;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.MockedFunction<
  typeof Notifications.requestPermissionsAsync
>;
const mockGetExpoPushToken = Notifications.getExpoPushTokenAsync as jest.MockedFunction<
  typeof Notifications.getExpoPushTokenAsync
>;

describe('registerPushTokenForEndpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage as any).clear();
  });

  it('requests an Expo token with the EAS project id and registers it with each endpoint', async () => {
    const post = jest.fn().mockResolvedValue({});
    mockGetEndpointClient.mockReturnValue({ post } as never);
    mockRequestPermissions.mockResolvedValue({ status: 'granted' } as never);
    mockGetExpoPushToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' } as never);

    await registerPushTokenForEndpoints([
      {
        id: 'ep-1',
        label: 'Mac',
        base_url: 'http://localhost:8080',
        token: 'tok',
        last_seen_at: null,
      },
    ]);

    expect(mockGetExpoPushToken).toHaveBeenCalledWith({
      projectId: '3555d4e1-4ac3-4e0c-9816-4383af1872e9',
    });
    expect(mockGetEndpointClient).toHaveBeenCalledWith('http://localhost:8080', 'tok');
    expect(post).toHaveBeenCalledWith('/api/v1/push-tokens', {
      expo_push_token: 'ExponentPushToken[abc]',
      device_label: 'MultiSoul iOS',
      endpoint_id: 'ep-1',
    });
    await expect(AsyncStorage.getItem('expo_push_token')).resolves.toBe('ExponentPushToken[abc]');
  });

  it('does not request an Expo token when notification permission is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' } as never);

    await registerPushTokenForEndpoints([
      {
        id: 'ep-1',
        label: 'Mac',
        base_url: 'http://localhost:8080',
        token: 'tok',
        last_seen_at: null,
      },
    ]);

    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
    expect(mockGetEndpointClient).not.toHaveBeenCalled();
  });
});

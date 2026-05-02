import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { getEndpointClient } from '@/api/endpointClient';
import { type Endpoint } from '@/types';

const DEVICE_LABEL = 'MultiSoul iOS';

function readEasProjectId(): string | undefined {
  const config: unknown = Constants.expoConfig as unknown;
  if (config === null || typeof config !== 'object') return undefined;
  const extra = (config as Record<string, unknown>).extra;
  if (extra === null || typeof extra !== 'object') return undefined;
  const eas = (extra as Record<string, unknown>).eas;
  if (eas === null || typeof eas !== 'object') return undefined;
  const id = (eas as Record<string, unknown>).projectId;
  return typeof id === 'string' ? id : undefined;
}

export async function registerPushTokenForEndpoints(endpoints: Endpoint[]): Promise<void> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    const projectId = readEasProjectId();
    if (!projectId) {
      console.warn('[push] missing EAS projectId, cannot register push token');
      return;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await AsyncStorage.setItem('expo_push_token', token);

    await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        const client = getEndpointClient(endpoint.base_url, endpoint.token);
        await client.post('/api/v1/push-tokens', {
          expo_push_token: token,
          device_label: DEVICE_LABEL,
          endpoint_id: endpoint.id,
        });
      }),
    );
  } catch (e) {
    console.warn('[push] registerPushToken skipped:', e);
  }
}

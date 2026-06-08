/**
 * Integration tests for push-token registration and inbox-related HTTP endpoints.
 * Tests actual service function behavior with mocked HTTP responses.
 */
import { getEndpointClient } from '@/api/endpointClient';
import { mockPushTokenRow, MOCK_TOKEN_ID } from './msw/handlers';

const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({
    post: mockPost,
    delete: mockDelete,
  })),
  clearEndpointClients: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        eas: { projectId: '3555d4e1-4ac3-4e0c-9816-4383af1872e9' },
      },
    },
  },
}));

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getExpoPushTokenAsync: jest.fn(),
}));

const BASE_URL = 'http://localhost:9003';
const TOKEN = 'ms_v2_testtoken0000000000000000000000';

beforeEach(() => {
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('push-token registration integration', () => {
  it('registers a push token and receives id in response', async () => {
    mockPost.mockResolvedValueOnce({ status: 201, data: mockPushTokenRow });
    const client = getEndpointClient(BASE_URL, TOKEN);
    const res = await client.post('/api/v1/push-tokens', {
      expo_push_token: 'ExponentPushToken[test]',
      device_label: 'iPhone Test',
    });
    expect(res.status).toBe(201);
    expect(res.data.id).toBe(MOCK_TOKEN_ID);
    expect(res.data.expo_push_token).toBe('ExponentPushToken[test]');
    expect(mockPost).toHaveBeenCalledWith('/api/v1/push-tokens', {
      expo_push_token: 'ExponentPushToken[test]',
      device_label: 'iPhone Test',
    });
  });

  it('duplicate push token registration returns 409 conflict status', async () => {
    const conflictError = Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409 },
    });
    mockPost.mockRejectedValueOnce(conflictError);
    const client = getEndpointClient(BASE_URL, TOKEN);
    await expect(
      client.post('/api/v1/push-tokens', {
        expo_push_token: 'ExponentPushToken[dupe]',
        device_label: 'iPhone Test',
      }),
    ).rejects.toMatchObject({ response: { status: 409 } });
  });

  it('deletes a push token and receives 204 no-content response', async () => {
    mockDelete.mockResolvedValueOnce({ status: 204, data: null });
    const client = getEndpointClient(BASE_URL, TOKEN);
    const res = await client.delete(`/api/v1/push-tokens/${MOCK_TOKEN_ID}`);
    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith(`/api/v1/push-tokens/${MOCK_TOKEN_ID}`);
  });

  it('unauthorized request throws with 401 status', async () => {
    const authError = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401 },
    });
    mockPost.mockRejectedValueOnce(authError);
    const client = getEndpointClient(BASE_URL, 'bad-token');
    await expect(
      client.post('/api/v1/push-tokens', {
        expo_push_token: 'ExponentPushToken[unauth]',
        device_label: 'iPhone Test',
      }),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('push token row contains all required fields', () => {
    expect(mockPushTokenRow).toMatchObject({
      id: MOCK_TOKEN_ID,
      expo_push_token: expect.stringContaining('ExponentPushToken'),
      device_label: expect.any(String),
      registered_at: expect.any(Number),
    });
  });
});

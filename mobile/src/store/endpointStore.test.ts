import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEndpointStore } from './endpointStore';

const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();

jest.mock('@/db', () => ({
  getDb: () => ({
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
  }),
}));

/// addEndpoint de-dupe: concurrent adds for the same machine must create one endpoint.
///
/// Data construction:
///   first base_url  = "https://Mac-Home.tailnet.ts.net:8765/".
///   second base_url = "https://mac-home.tailnet.ts.net:8765".
///   normalized form = "https://mac-home.tailnet.ts.net:8765" for both.
///   token values    = "token-a" and "token-b" to prove the duplicate call is not persisted.
///
/// Execution:
///   1. Reset endpointStore to an empty endpoints array.
///   2. Start two addEndpoint calls without awaiting the first before the second starts.
///   3. Wait for both promises to settle.
///   4. Inspect DB insert calls, AsyncStorage token writes, and in-memory endpoints.
///
/// Expected:
///   - Positive: one endpoint exists for the normalized base URL.
///   - Positive: the DB receives exactly one INSERT.
///   - Negative: a second endpoint with the duplicate label is not added.
///   - Negative: the duplicate token is not written to AsyncStorage.
it('coalesces concurrent duplicate base_url additions into one endpoint', async () => {
  mockRunAsync.mockResolvedValue(undefined);
  mockGetAllAsync.mockResolvedValue([]);
  await AsyncStorage.clear();
  useEndpointStore.setState({ endpoints: [] });

  await Promise.all([
    useEndpointStore.getState().addEndpoint({
      label: 'Mac Home',
      base_url: 'https://Mac-Home.tailnet.ts.net:8765/',
      token: 'token-a',
    }),
    useEndpointStore.getState().addEndpoint({
      label: 'Duplicate Mac Home',
      base_url: 'https://mac-home.tailnet.ts.net:8765',
      token: 'token-b',
    }),
  ]);

  const endpoints = useEndpointStore.getState().endpoints;
  const tokenValues = Object.values(
    (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
      .__INTERNAL_MOCK_STORAGE__,
  );

  expect(endpoints).toHaveLength(1);
  expect(endpoints[0]?.label).toBe('Mac Home');
  expect(endpoints[0]?.base_url).toBe('https://mac-home.tailnet.ts.net:8765');
  expect(mockRunAsync).toHaveBeenCalledTimes(1);
  expect(tokenValues).toContain('token-a');
  expect(endpoints.some((endpoint) => endpoint.label === 'Duplicate Mac Home')).toBe(false);
  expect(tokenValues).not.toContain('token-b');
});

/**
 * Integration tests for settings store and API client behavior.
 * Tests that the Zustand store saves settings and that getApiClient picks them up.
 */
import { getApiClient } from '@/api';
import { useSettingsStore } from '@/store/settingsStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/features/settings/services/settingsService', () => ({
  loadSettings: jest.fn().mockResolvedValue({
    serverUrl: 'http://localhost:8080',
    apiKey: '',
    connectionMode: 'custom',
    relayToken: '',
    relayWorkerUrl: 'https://placeholder.workers.dev',
  }),
  saveSettings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('axios', () => {
  const mockCreate = jest.fn(() => ({
    defaults: {
      baseURL: '',
      headers: { common: {} },
    },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  }));
  return { create: mockCreate, default: { create: mockCreate } };
});

describe('settings store integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({
      settings: {
        serverUrl: 'http://localhost:8080',
        apiKey: '',
        connectionMode: 'custom',
        relayToken: '',
        relayWorkerUrl: 'https://placeholder.workers.dev',
      },
    });
  });

  it('save updates the store state immediately', async () => {
    const newSettings = {
      serverUrl: 'http://192.168.1.100:8765',
      apiKey: 'ms_v2_testkey00000000000000000000000',
      connectionMode: 'custom' as const,
      relayToken: '',
      relayWorkerUrl: 'https://placeholder.workers.dev',
    };
    await useSettingsStore.getState().save(newSettings);
    const stored = useSettingsStore.getState().settings;
    expect(stored.serverUrl).toBe('http://192.168.1.100:8765');
    expect(stored.apiKey).toBe('ms_v2_testkey00000000000000000000000');
  });

  it('getApiClient uses serverUrl as baseURL from store', () => {
    const axios = require('axios');
    useSettingsStore.setState({
      settings: {
        serverUrl: 'http://192.168.1.5:8765',
        apiKey: 'ms_v2_testkey00000000000000000000000',
        connectionMode: 'custom',
        relayToken: '',
        relayWorkerUrl: 'https://placeholder.workers.dev',
      },
    });
    getApiClient();
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://192.168.1.5:8765' }),
    );
  });

  it('getApiClient sets Bearer Authorization header when apiKey is set', () => {
    const axios = require('axios');
    const mockInstance = {
      defaults: { baseURL: '', headers: { common: {} } },
      interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    axios.create.mockReturnValue(mockInstance);

    useSettingsStore.setState({
      settings: {
        serverUrl: 'http://localhost:8765',
        apiKey: 'ms_v2_sometoken123456789012345678901',
        connectionMode: 'custom',
        relayToken: '',
        relayWorkerUrl: 'https://placeholder.workers.dev',
      },
    });
    getApiClient();
    expect(mockInstance.defaults.headers.common['Authorization']).toBe(
      'Bearer ms_v2_sometoken123456789012345678901',
    );
  });

  it('getApiClient does not set Authorization header when apiKey is empty', () => {
    const axios = require('axios');
    const mockInstance = {
      defaults: { baseURL: '', headers: { common: {} } },
      interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    axios.create.mockReturnValue(mockInstance);

    useSettingsStore.setState({
      settings: {
        serverUrl: 'http://localhost:8765',
        apiKey: '',
        connectionMode: 'custom',
        relayToken: '',
        relayWorkerUrl: 'https://placeholder.workers.dev',
      },
    });
    getApiClient();
    expect(mockInstance.defaults.headers.common['Authorization']).toBeUndefined();
  });
});

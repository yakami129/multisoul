jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: {
      request: { use: jest.fn() },
    },
    defaults: { baseURL: '', headers: { common: {} } },
  })),
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: jest.fn(() => ({
      settings: { serverUrl: 'http://test:8080', apiKey: 'ms_testkey123' },
    })),
  },
}));

/// getApiClient: sets Authorization header from stored apiKey
///
/// Data:
///   apiKey = 'ms_testkey123'
///   serverUrl = 'http://test:8080'
///
/// Execution:
///   1. Zustand store has settings with apiKey and serverUrl
///   2. getApiClient() called (sync)
///
/// Expected:
///   - axios instance created with baseURL = 'http://test:8080'
///   - Authorization header set on client defaults
describe('api client', () => {
  it('configures baseURL and Authorization header from settings', () => {
    const axios = require('axios');
    const mockInstance = {
      interceptors: { request: { use: jest.fn() } },
      defaults: { baseURL: '', headers: { common: {} } },
    };
    axios.create.mockReturnValue(mockInstance);

    const { getApiClient } = require('../api');
    getApiClient();

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://test:8080' }),
    );
    expect(mockInstance.defaults.headers.common['Authorization']).toBe('Bearer ms_testkey123');
  });
});

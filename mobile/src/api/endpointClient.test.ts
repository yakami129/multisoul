import { useEndpointStore } from '@/store/endpointStore';
import { clearEndpointClients, getEndpointClient } from './endpointClient';

const responseHandlers: Array<(response: unknown) => unknown> = [];

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: {
      response: {
        use: jest.fn((onFulfilled: (response: unknown) => unknown) => {
          responseHandlers.push(onFulfilled);
        }),
      },
    },
    get: jest.fn(),
  })),
}));

describe('endpointClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    responseHandlers.length = 0;
    clearEndpointClients();
    useEndpointStore.setState({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Home',
          base_url: 'http://127.0.0.1:8765',
          token: 'tok',
          last_seen_at: null,
        },
      ],
    });
  });

  it('updates last_seen_at after a successful API response', async () => {
    const updateLastSeen = jest
      .spyOn(useEndpointStore.getState(), 'updateLastSeen')
      .mockResolvedValue();

    getEndpointClient('http://127.0.0.1:8765/', 'tok');
    const onFulfilled = responseHandlers[0];
    expect(onFulfilled).toBeDefined();

    onFulfilled?.({
      status: 200,
      config: { baseURL: 'http://127.0.0.1:8765/' },
    });

    expect(updateLastSeen).toHaveBeenCalledWith('ep-1', expect.any(Number));
  });

  it('does not update last_seen_at for non-2xx responses', () => {
    const updateLastSeen = jest
      .spyOn(useEndpointStore.getState(), 'updateLastSeen')
      .mockResolvedValue();

    getEndpointClient('http://127.0.0.1:8765', 'tok');
    const onFulfilled = responseHandlers.at(-1);
    onFulfilled?.({
      status: 503,
      config: { baseURL: 'http://127.0.0.1:8765' },
    });

    expect(updateLastSeen).not.toHaveBeenCalled();
  });
});

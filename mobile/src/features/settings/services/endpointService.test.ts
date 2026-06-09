import axios from 'axios';
import { useEndpointStore } from '@/store/endpointStore';
import { pingAllEndpoints } from './endpointService';

jest.mock('axios', () => ({
  default: { get: jest.fn() },
  get: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('endpointService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('updates last_seen_at for reachable endpoints', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200 });
    const updateLastSeen = jest
      .spyOn(useEndpointStore.getState(), 'updateLastSeen')
      .mockResolvedValue();

    await pingAllEndpoints();

    expect(mockedAxios.get).toHaveBeenCalledWith('http://127.0.0.1:8765/api/v1/healthz', {
      timeout: 5000,
    });
    expect(updateLastSeen).toHaveBeenCalledWith('ep-1', expect.any(Number));
  });

  it('leaves last_seen_at unchanged when healthz fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('offline'));
    const updateLastSeen = jest
      .spyOn(useEndpointStore.getState(), 'updateLastSeen')
      .mockResolvedValue();

    await pingAllEndpoints();

    expect(updateLastSeen).not.toHaveBeenCalled();
  });
});

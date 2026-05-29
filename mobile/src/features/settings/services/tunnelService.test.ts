import { fetchTunnelUrl } from './tunnelService';

global.fetch = jest.fn();

describe('fetchTunnelUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns tunnel_url when KV responds with status active', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'active',
        tunnel_url: 'https://test-tunnel.trycloudflare.com',
        updated_at: '2026-05-29T00:00:00Z',
      }),
    });

    const result = await fetchTunnelUrl('https://worker.example.com', 'ms_v2_abc123');
    expect(result).toBe('https://test-tunnel.trycloudflare.com');
    expect(global.fetch).toHaveBeenCalledWith('https://worker.example.com/tunnel/ms_v2_abc123');
  });

  it('returns null when KV responds with status not_found', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ status: 'not_found' }),
    });

    const result = await fetchTunnelUrl('https://worker.example.com', 'ms_v2_abc123');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    const result = await fetchTunnelUrl('https://worker.example.com', 'ms_v2_abc123');
    expect(result).toBeNull();
  });
});

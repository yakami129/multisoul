import { fetchTunnelUrl, pollTunnelUrl } from './tunnelService';

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
    expect(global.fetch).toHaveBeenCalledWith(
      'https://worker.example.com/tunnel/ms_v2_abc123',
      expect.objectContaining({}),
    );
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

describe('pollTunnelUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns tunnel URL immediately when first fetch succeeds', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'active',
        tunnel_url: 'https://quick.trycloudflare.com',
      }),
    });

    const { promise } = pollTunnelUrl('https://worker.example.com', 'ms_v2_abc', 100, 5000);
    const result = await promise;
    expect(result).toBe('https://quick.trycloudflare.com');
  });

  it('abort() cancels the poll and rejects the promise', async () => {
    // Mock fetch to respect AbortSignal
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, options?: { signal?: AbortSignal }) => {
        return new Promise((resolve, reject) => {
          if (options?.signal) {
            // If signal is already aborted, reject immediately
            if (options.signal.aborted) {
              reject(new DOMException('The operation was aborted', 'AbortError'));
              return;
            }
            // Listen for abort event
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }
          // Never resolve (simulating hanging fetch)
        });
      },
    );

    const { promise, abort } = pollTunnelUrl('https://worker.example.com', 'ms_v2_abc', 100, 5000);

    // Abort immediately
    abort();

    // The promise should reject with the cancellation message
    await expect(promise).rejects.toThrow('Tunnel poll cancelled');
  });
});

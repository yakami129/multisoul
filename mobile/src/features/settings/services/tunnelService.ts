/**
 * Fetches tunnel URL from Cloudflare Workers KV.
 * Returns tunnel_url string, or null (not found / network error).
 */
export async function fetchTunnelUrl(
  workerUrl: string,
  userToken: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const resp = await fetch(`${workerUrl}/tunnel/${userToken}`, { signal });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { status: string; tunnel_url?: string };
    if (data.status === 'active' && data.tunnel_url) {
      return data.tunnel_url;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Polls KV until tunnel URL is found or timeout.
 * Returns { promise, abort } so callers can cancel on unmount or re-press.
 * intervalMs: poll interval (default 10s)
 * timeoutMs: max wait time (default 5min)
 */
export function pollTunnelUrl(
  workerUrl: string,
  userToken: string,
  intervalMs = 10_000,
  timeoutMs = 300_000,
): { promise: Promise<string>; abort: () => void } {
  const controller = new AbortController();

  const promise = (async (): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (controller.signal.aborted) {
        throw new Error('Tunnel poll cancelled');
      }
      const url = await fetchTunnelUrl(workerUrl, userToken, controller.signal);
      if (url) return url;
      // Wait for next interval, bail early if aborted
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Tunnel poll cancelled'));
        });
      });
    }
    throw new Error('Timed out waiting for msctl serve --relay to start (5 min)');
  })();

  return { promise, abort: () => controller.abort() };
}

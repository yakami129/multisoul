/**
 * Fetches tunnel URL from Cloudflare Workers KV.
 * Returns tunnel_url string, or null (not found / network error).
 */
export async function fetchTunnelUrl(workerUrl: string, userToken: string): Promise<string | null> {
  try {
    const resp = await fetch(`${workerUrl}/tunnel/${userToken}`);
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
 * intervalMs: poll interval (default 10s)
 * timeoutMs: max wait time (default 5min)
 */
export async function pollTunnelUrl(
  workerUrl: string,
  userToken: string,
  intervalMs = 10_000,
  timeoutMs = 300_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await fetchTunnelUrl(workerUrl, userToken);
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for msctl serve --relay to start (5 min)');
}

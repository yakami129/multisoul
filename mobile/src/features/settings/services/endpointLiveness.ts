export const ENDPOINT_ONLINE_THRESHOLD_MS = 60_000;

export function normalizeEndpointBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function endpointOnline(lastSeenAt: number | null, now = Date.now()): boolean {
  return lastSeenAt !== null && now - lastSeenAt < ENDPOINT_ONLINE_THRESHOLD_MS;
}

export function countOnlineEndpoints(
  endpoints: { last_seen_at: number | null }[],
  now = Date.now(),
): number {
  return endpoints.filter((ep) => endpointOnline(ep.last_seen_at, now)).length;
}

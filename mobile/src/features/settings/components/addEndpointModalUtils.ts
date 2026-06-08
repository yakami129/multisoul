export function parsePairConnection(input: string): { url: string; token: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'multisoul:') return null;
    const url = parsed.searchParams.get('url') ?? '';
    const token = parsed.searchParams.get('token') ?? '';
    if (!url || !token) return null;
    return { url, token };
  } catch {
    return null;
  }
}

export function getEndpointLabel(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname;
    if (hostname) return hostname;
  } catch {
    const withoutScheme = baseUrl.replace(/^[a-z]+:\/\//i, '');
    const host = withoutScheme.split(/[/:?#]/)[0];
    if (host) return host;
  }
  return baseUrl;
}

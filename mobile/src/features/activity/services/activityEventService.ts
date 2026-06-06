export function buildActivityEventsWsUrl(baseUrl: string, token: string): string {
  const wsBase = baseUrl
    .replace(/^https/, 'wss')
    .replace(/^http/, 'ws')
    .replace(/\/$/, '');
  return `${wsBase}/ws/activity?token=${encodeURIComponent(token)}`;
}

import { countOnlineEndpoints, endpointOnline, normalizeEndpointBaseUrl } from './endpointLiveness';

describe('endpointLiveness', () => {
  it('normalizes endpoint base URLs for matching', () => {
    expect(normalizeEndpointBaseUrl('https://Mac-Home.tailnet.ts.net:8765/')).toBe(
      'https://mac-home.tailnet.ts.net:8765',
    );
    expect(normalizeEndpointBaseUrl('http://10.0.0.2:8765/')).toBe('http://10.0.0.2:8765');
  });

  it('treats last_seen_at within 60s as online', () => {
    const now = 1_700_000_000_000;
    expect(endpointOnline(now - 30_000, now)).toBe(true);
    expect(endpointOnline(now - 60_001, now)).toBe(false);
    expect(endpointOnline(null, now)).toBe(false);
  });

  it('counts online endpoints', () => {
    const now = 1_700_000_000_000;
    expect(
      countOnlineEndpoints(
        [{ last_seen_at: now - 1_000 }, { last_seen_at: null }, { last_seen_at: now - 90_000 }],
        now,
      ),
    ).toBe(1);
  });
});

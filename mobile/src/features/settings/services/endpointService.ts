import axios from 'axios';
import { useEndpointStore } from '@/store/endpointStore';

/** Ping /api/v1/healthz for each endpoint and batch-update last_seen_at. */
export async function pingAllEndpoints(): Promise<void> {
  const { endpoints } = useEndpointStore.getState();
  const now = Date.now();
  const results = await Promise.allSettled(
    endpoints.map(async (ep) => {
      await axios.get(`${ep.base_url}/api/v1/healthz`, { timeout: 5000 });
      return ep.id;
    }),
  );
  const onlineIds = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (onlineIds.length > 0) {
    await useEndpointStore.getState().batchUpdateLastSeen(onlineIds, now);
  }
}

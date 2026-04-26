import axios from 'axios';
import { useEndpointStore } from '@/store/endpointStore';

/** Ping /api/v1/healthz for each endpoint and update last_seen_at. */
export async function pingAllEndpoints(): Promise<void> {
  const { endpoints, updateLastSeen } = useEndpointStore.getState();
  await Promise.allSettled(
    endpoints.map(async (ep) => {
      try {
        await axios.get(`${ep.base_url}/api/v1/healthz`, { timeout: 5000 });
        await updateLastSeen(ep.id, Date.now());
      } catch {
        // endpoint offline — last_seen_at stays stale
      }
    }),
  );
}

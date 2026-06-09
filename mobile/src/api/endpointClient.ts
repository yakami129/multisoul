import axios, { type AxiosInstance } from 'axios';
import { normalizeEndpointBaseUrl } from '@/features/settings/services/endpointLiveness';
import { useEndpointStore } from '@/store/endpointStore';

const _clients: Map<string, AxiosInstance> = new Map();

function touchEndpointLastSeen(baseUrl: string | undefined): void {
  if (!baseUrl) return;
  const normalized = normalizeEndpointBaseUrl(baseUrl);
  const { endpoints, updateLastSeen } = useEndpointStore.getState();
  const match = endpoints.find((ep) => normalizeEndpointBaseUrl(ep.base_url) === normalized);
  if (match) void updateLastSeen(match.id, Date.now());
}

export function getEndpointClient(base_url: string, token: string): AxiosInstance {
  const key = `${base_url}::${token}`;
  if (!_clients.has(key)) {
    const instance = axios.create({
      baseURL: base_url,
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    instance.interceptors.response.use((response) => {
      if (response.status >= 200 && response.status < 300) {
        touchEndpointLastSeen(response.config.baseURL);
      }
      return response;
    });
    _clients.set(key, instance);
  }
  return _clients.get(key)!;
}

export function clearEndpointClients(): void {
  _clients.clear();
}

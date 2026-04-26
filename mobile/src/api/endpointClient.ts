import axios, { type AxiosInstance } from 'axios';

const _clients: Map<string, AxiosInstance> = new Map();

export function getEndpointClient(base_url: string, token: string): AxiosInstance {
  const key = `${base_url}::${token}`;
  if (!_clients.has(key)) {
    _clients.set(
      key,
      axios.create({
        baseURL: base_url,
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }),
    );
  }
  return _clients.get(key)!;
}

export function clearEndpointClients(): void {
  _clients.clear();
}

import axios, { AxiosInstance } from 'axios';
import { useSettingsStore } from '@/store/settingsStore';

export function getApiClient(): AxiosInstance {
  const { serverUrl, apiKey } = useSettingsStore.getState().settings;

  const client = axios.create({
    baseURL: serverUrl,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  });

  if (apiKey) {
    client.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
  }

  return client;
}

export function resetApiClient(): void {
  // no-op: client is created fresh each call
}

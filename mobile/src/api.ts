import axios, { type AxiosInstance } from 'axios';
import { TelemetryService } from '@/services/telemetry';
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

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      try {
        const statusCode = (error as { response?: { status?: number } }).response?.status;
        const config = error as { config?: { method?: string; url?: string } };
        const method = config.config?.method?.toUpperCase() ?? 'UNKNOWN';
        const path = config.config?.url ?? '';
        TelemetryService.getInstance().track({
          event_type: 'api_error',
          level: 'error',
          data: {
            method,
            path,
            status_code: statusCode ?? 0,
            duration_ms: 0,
          },
        });
      } catch {
        // Never let telemetry break the API call
      }
      return Promise.reject(error);
    },
  );

  return client;
}

export function resetApiClient(): void {
  // no-op: client is created fresh each call
}

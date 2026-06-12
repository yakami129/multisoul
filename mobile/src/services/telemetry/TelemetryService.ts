import { AppState } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useSettingsStore } from '@/store/settingsStore';

export type TelemetryEventType =
  | 'js_crash'
  | 'api_error'
  | 'ws_error'
  | 'route_load'
  | 'module_load';

export interface TelemetryEvent {
  mobile_session_id: string;
  event_id: string;
  event_type: TelemetryEventType;
  level: 'info' | 'warn' | 'error';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface TelemetryBatch {
  events: TelemetryEvent[];
}

const MAX_QUEUE_SIZE = 200;
const FLUSH_INTERVAL_MS = 30_000;

export class TelemetryService {
  private static instance: TelemetryService | null = null;

  private readonly mobile_session_id: string;
  private queue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  private constructor() {
    this.mobile_session_id = uuidv4();
    this.startFlushTimer();
    this.startAppStateListener();
  }

  static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  track(partial: Omit<TelemetryEvent, 'mobile_session_id' | 'event_id' | 'timestamp'>): void {
    const event: TelemetryEvent = {
      mobile_session_id: this.mobile_session_id,
      event_id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...partial,
    };

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }
    this.queue.push(event);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.slice();
    this.queue = [];

    try {
      const { serverUrl, apiKey } = useSettingsStore.getState().settings;
      if (!serverUrl || !apiKey) return;

      const axiosDefault = (await import('axios')).default;
      const client = axiosDefault.create({
        baseURL: serverUrl,
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });

      await client.post<{ accepted: number }>('/api/v1/telemetry', {
        events: batch,
      } satisfies TelemetryBatch);
    } catch (err) {
      // Re-enqueue failed events at the front (drop if they would exceed the cap)
      const space = MAX_QUEUE_SIZE - this.queue.length;
      if (space > 0) {
        const toRequeue = batch.slice(0, space);
        this.queue = [...toRequeue, ...this.queue];
      }
      console.warn('[TelemetryService] flush failed:', err);
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private startAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void this.flush();
      }
    });
  }

  /** Only for tests — resets the singleton so a fresh instance can be created. */
  static _resetForTests(): void {
    if (TelemetryService.instance) {
      if (TelemetryService.instance.flushTimer !== null) {
        clearInterval(TelemetryService.instance.flushTimer);
      }
      TelemetryService.instance.appStateSubscription?.remove();
      TelemetryService.instance = null;
    }
  }
}

import { useEffect, useMemo, useRef } from 'react';
import { type Endpoint } from '@/types';
import { buildActivityEventsWsUrl } from '@/features/activity/services/activityEventService';

export const SPEC_EVENT_DEBOUNCE_MS = 250;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

type TimerHandle = ReturnType<typeof setTimeout>;
type SpecEndpoint = Pick<Endpoint, 'id' | 'base_url' | 'token'>;

interface UseSpecEventsOptions {
  endpoints: Endpoint[];
  enabled: boolean;
  onRefresh: () => void | Promise<void>;
}

function isSpecChangedFrame(data: string): boolean {
  try {
    const envelope = JSON.parse(data) as { type?: unknown };
    return envelope.type === 'spec_changed';
  } catch {
    return false;
  }
}

export function useSpecEvents({ endpoints, enabled, onRefresh }: UseSpecEventsOptions) {
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const socketEndpoints = useMemo<SpecEndpoint[]>(
    () =>
      endpoints.map((endpoint) => ({
        id: endpoint.id,
        base_url: endpoint.base_url,
        token: endpoint.token,
      })),
    [endpoints],
  );

  useEffect(() => {
    if (!enabled || socketEndpoints.length === 0) return undefined;

    let active = true;
    let refreshDebounceTimer: TimerHandle | null = null;
    const sockets = new Map<string, WebSocket>();
    const reconnectDelayByEndpoint = new Map<string, number>();
    const reconnectTimers = new Set<TimerHandle>();

    const refreshNow = () => {
      if (!active) return;
      void onRefreshRef.current();
    };

    const scheduleDebouncedRefresh = () => {
      if (!active) return;
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = setTimeout(() => {
        refreshDebounceTimer = null;
        refreshNow();
      }, SPEC_EVENT_DEBOUNCE_MS);
    };

    const connect = (endpoint: SpecEndpoint) => {
      if (!active) return;

      const ws = new WebSocket(buildActivityEventsWsUrl(endpoint.base_url, endpoint.token));
      sockets.set(endpoint.id, ws);

      ws.onopen = () => {
        if (!active || sockets.get(endpoint.id) !== ws) return;
        reconnectDelayByEndpoint.set(endpoint.id, INITIAL_RECONNECT_DELAY_MS);
        refreshNow();
      };

      ws.onmessage = (event) => {
        if (!active || sockets.get(endpoint.id) !== ws) return;
        if (isSpecChangedFrame(event.data as string)) {
          scheduleDebouncedRefresh();
        }
      };

      ws.onclose = () => {
        if (!active || sockets.get(endpoint.id) !== ws) return;
        const delay = reconnectDelayByEndpoint.get(endpoint.id) ?? INITIAL_RECONNECT_DELAY_MS;
        reconnectDelayByEndpoint.set(endpoint.id, Math.min(delay * 2, MAX_RECONNECT_DELAY_MS));
        const timer = setTimeout(() => {
          reconnectTimers.delete(timer);
          connect(endpoint);
        }, delay);
        reconnectTimers.add(timer);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    socketEndpoints.forEach(connect);

    return () => {
      active = false;
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      reconnectTimers.forEach((timer) => {
        clearTimeout(timer);
      });
      sockets.forEach((ws) => {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      });
      sockets.clear();
    };
  }, [enabled, socketEndpoints]);
}

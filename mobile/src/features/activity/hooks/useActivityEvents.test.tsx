import { act, renderHook } from '@testing-library/react-native';
import { type Endpoint } from '@/types';
import { ACTIVITY_EVENT_DEBOUNCE_MS, useActivityEvents } from './useActivityEvents';
import { buildActivityEventsWsUrl } from '../services/activityEventService';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  constructor(public url: string) {
    instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  closeFromServer() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emit(data: string) {
    this.onmessage?.({ data });
  }
}

let instances: MockWebSocket[] = [];
const WebSocketConstructor = jest.fn((url: string) => new MockWebSocket(url));
WebSocketConstructor.CONNECTING = MockWebSocket.CONNECTING;
WebSocketConstructor.OPEN = MockWebSocket.OPEN;
WebSocketConstructor.CLOSED = MockWebSocket.CLOSED;

function endpoints(): Endpoint[] {
  return [
    {
      id: 'ep-1',
      label: 'Office Mac',
      base_url: 'http://office.local:8765',
      token: 'tok office',
      last_seen_at: null,
    },
    {
      id: 'ep-2',
      label: 'Studio Mac',
      base_url: 'https://studio.local:8765',
      token: 'tok/studio',
      last_seen_at: null,
    },
  ];
}

describe('useActivityEvents', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    instances = [];
    global.WebSocket = WebSocketConstructor as unknown as typeof WebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('builds encoded Activity event socket URLs', () => {
    expect(buildActivityEventsWsUrl('http://office.local:8765', 'tok office')).toBe(
      'ws://office.local:8765/ws/activity?token=tok%20office',
    );
    expect(buildActivityEventsWsUrl('https://studio.local:8765/', 'tok/studio')).toBe(
      'wss://studio.local:8765/ws/activity?token=tok%2Fstudio',
    );
  });

  it('opens one socket per endpoint only when enabled', () => {
    const onRefresh = jest.fn();
    const configuredEndpoints = endpoints();
    const { rerender } = renderHook(
      ({ enabled }) =>
        useActivityEvents({
          endpoints: configuredEndpoints,
          enabled,
          onRefresh,
        }),
      { initialProps: { enabled: false } },
    );

    expect(WebSocketConstructor).not.toHaveBeenCalled();

    rerender({ enabled: true });

    expect(WebSocketConstructor).toHaveBeenCalledTimes(2);
    expect(instances.map((ws) => ws.url)).toEqual([
      'ws://office.local:8765/ws/activity?token=tok%20office',
      'wss://studio.local:8765/ws/activity?token=tok%2Fstudio',
    ]);
  });

  it('refreshes when a socket opens', () => {
    const onRefresh = jest.fn();
    renderHook(() =>
      useActivityEvents({
        endpoints: [endpoints()[0]],
        enabled: true,
        onRefresh,
      }),
    );

    act(() => {
      instances[0].open();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('debounces bursts of activity_changed frames into one refresh', () => {
    const onRefresh = jest.fn();
    renderHook(() =>
      useActivityEvents({
        endpoints: [endpoints()[0]],
        enabled: true,
        onRefresh,
      }),
    );

    act(() => {
      instances[0].open();
    });
    onRefresh.mockClear();

    act(() => {
      instances[0].emit(JSON.stringify({ type: 'activity_changed', reason: 'user_message' }));
      instances[0].emit(JSON.stringify({ type: 'activity_changed', reason: 'task_terminal' }));
      instances[0].emit(JSON.stringify({ type: 'activity_changed', reason: 'read_state_changed' }));
      jest.advanceTimersByTime(ACTIVITY_EVENT_DEBOUNCE_MS - 1);
    });
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('reconnects with backoff while enabled and refreshes on reconnect open', () => {
    const onRefresh = jest.fn();
    renderHook(() =>
      useActivityEvents({
        endpoints: [endpoints()[0]],
        enabled: true,
        onRefresh,
      }),
    );

    act(() => {
      instances[0].open();
      instances[0].closeFromServer();
    });
    expect(WebSocketConstructor).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(WebSocketConstructor).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(WebSocketConstructor).toHaveBeenCalledTimes(2);

    act(() => {
      instances[1].open();
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('cleans up sockets and timers on disable', () => {
    const onRefresh = jest.fn();
    const { rerender } = renderHook(
      ({ enabled }) =>
        useActivityEvents({
          endpoints: [endpoints()[0]],
          enabled,
          onRefresh,
        }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      instances[0].closeFromServer();
    });
    rerender({ enabled: false });

    expect(instances[0].close).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(WebSocketConstructor).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed and unrelated frames', () => {
    const onRefresh = jest.fn();
    renderHook(() =>
      useActivityEvents({
        endpoints: [endpoints()[0]],
        enabled: true,
        onRefresh,
      }),
    );

    act(() => {
      instances[0].open();
    });
    onRefresh.mockClear();

    act(() => {
      instances[0].emit('{');
      instances[0].emit(JSON.stringify({ type: 'pong' }));
      jest.advanceTimersByTime(ACTIVITY_EVENT_DEBOUNCE_MS);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from '@testing-library/react-native';
import { type Endpoint } from '@/types';
import { SPEC_EVENT_DEBOUNCE_MS, useSpecEvents } from './useSpecEvents';

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

const endpoints: Endpoint[] = [
  {
    id: 'ep-1',
    label: 'Office Mac',
    base_url: 'http://office.local:8765',
    token: 'tok office',
    last_seen_at: 1,
  },
];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  instances = [];
  global.WebSocket = WebSocketConstructor as unknown as typeof WebSocket;
});

afterEach(() => {
  jest.useRealTimers();
});

test('opens activity event sockets only when enabled and refreshes on open', () => {
  const onRefresh = jest.fn();
  const { rerender } = renderHook(
    ({ enabled }) => useSpecEvents({ endpoints, enabled, onRefresh }),
    { initialProps: { enabled: false } },
  );

  expect(WebSocketConstructor).not.toHaveBeenCalled();
  rerender({ enabled: true });
  expect(instances[0].url).toBe('ws://office.local:8765/ws/activity?token=tok%20office');

  act(() => {
    instances[0].open();
  });
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test('debounces spec_changed frames and ignores unrelated frames', () => {
  const onRefresh = jest.fn();
  renderHook(() => useSpecEvents({ endpoints, enabled: true, onRefresh }));

  act(() => {
    instances[0].open();
  });
  onRefresh.mockClear();

  act(() => {
    instances[0].emit(JSON.stringify({ type: 'activity_changed' }));
    instances[0].emit('{');
    instances[0].emit(JSON.stringify({ type: 'spec_changed', spec_id: 'spec-1' }));
    instances[0].emit(JSON.stringify({ type: 'spec_changed', spec_id: 'spec-2' }));
    jest.advanceTimersByTime(SPEC_EVENT_DEBOUNCE_MS - 1);
  });
  expect(onRefresh).not.toHaveBeenCalled();

  act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test('reconnects with backoff while enabled and cleans up on unmount', () => {
  const onRefresh = jest.fn();
  const { unmount } = renderHook(() => useSpecEvents({ endpoints, enabled: true, onRefresh }));

  act(() => {
    instances[0].closeFromServer();
    jest.advanceTimersByTime(1_000);
  });
  expect(WebSocketConstructor).toHaveBeenCalledTimes(2);

  unmount();
  expect(instances[1].close).toHaveBeenCalledTimes(1);
  act(() => {
    instances[1].closeFromServer();
    jest.advanceTimersByTime(30_000);
  });
  expect(WebSocketConstructor).toHaveBeenCalledTimes(2);
});

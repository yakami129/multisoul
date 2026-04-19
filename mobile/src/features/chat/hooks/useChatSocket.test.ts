import { renderHook, act } from '@testing-library/react-native';
import { useChatSocket } from './useChatSocket';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
}

let instances: MockWebSocket[] = [];
beforeEach(() => { instances = []; (global as any).WebSocket = MockWebSocket; });

// T-1: initial status is 'connecting'
//
// Expected: status=='connecting' immediately after mount
test('initial status is connecting', () => {
  const { result } = renderHook(() =>
    useChatSocket({ agentId: 'agent-1', serverUrl: 'ws://localhost:8080', apiKey: 'key-1' })
  );
  expect(result.current.status).toBe('connecting');
});

// T-2: history message populates messages array
//
// Execution:
//   1. WS opens
//   2. Server sends history with 2 messages
//
// Expected:
//   - messages.length == 2
//   - first message role=='user', text=='hello'
test('history message populates messages', () => {
  const { result } = renderHook(() =>
    useChatSocket({ agentId: 'agent-1', serverUrl: 'ws://localhost:8080', apiKey: 'key-1' })
  );
  const ws = instances[0];
  act(() => { ws.open(); });
  act(() => {
    ws.onmessage?.({ data: JSON.stringify({
      type: 'history',
      payload: { agent_id: 'agent-1', messages: [
        { id: 'm1', role: 'user', text: 'hello', created_at: '2026-01-01T00:00:00Z' },
        { id: 'm2', role: 'assistant', text: 'hi', created_at: '2026-01-01T00:00:01Z' },
      ]}
    })});
  });
  expect(result.current.messages).toHaveLength(2);
  expect(result.current.messages[0].role).toBe('user');
  expect(result.current.messages[0].text).toBe('hello');
});

// T-3: chunk with done=false replaces assistant message in-place
//
// Execution:
//   1. Receive chunk done=false with message_id='r1', text='hel'
//   2. Receive chunk done=false with message_id='r1', text='hello'
//
// Expected:
//   - messages has 1 assistant message with text=='hello' (replaced, not appended twice)
test('streaming chunk replaces message content', () => {
  const { result } = renderHook(() =>
    useChatSocket({ agentId: 'agent-1', serverUrl: 'ws://localhost:8080', apiKey: 'key-1' })
  );
  const ws = instances[0];
  act(() => { ws.open(); });
  act(() => {
    ws.onmessage?.({ data: JSON.stringify({
      type: 'chunk', payload: { message_id: 'r1', agent_id: 'agent-1', text: 'hel', done: false }
    })});
  });
  act(() => {
    ws.onmessage?.({ data: JSON.stringify({
      type: 'chunk', payload: { message_id: 'r1', agent_id: 'agent-1', text: 'hello', done: false }
    })});
  });
  const assistantMsgs = result.current.messages.filter(m => m.role === 'assistant');
  expect(assistantMsgs).toHaveLength(1);
  expect(assistantMsgs[0].text).toBe('hello');
});

// T-4: send() sends JSON message over WebSocket
//
// Expected: ws.sent contains one message with type=='message' and correct agent_id/text
test('send() sends message over WebSocket', () => {
  const { result } = renderHook(() =>
    useChatSocket({ agentId: 'agent-1', serverUrl: 'ws://localhost:8080', apiKey: 'key-1' })
  );
  const ws = instances[0];
  act(() => { ws.open(); });
  act(() => { result.current.send('hello world'); });

  expect(ws.sent).toHaveLength(1);
  const sent = JSON.parse(ws.sent[0]);
  expect(sent.type).toBe('message');
  expect(sent.payload.agent_id).toBe('agent-1');
  expect(sent.payload.text).toBe('hello world');
});

import type { WsMessage } from '@/types';
import {
  collapseTodoToolCallSnapshots,
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
  isRenderableInChatTranscript,
} from './chatRenderState';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) throw new Error(message);
  expect(actual).toBe(expected);
}

function message(seq: number, role: WsMessage['role']): WsMessage {
  return {
    type: 'message',
    seq,
    role,
    payload:
      role === 'user_text'
        ? { text: 'user' }
        : role === 'agent_text'
          ? { text: 'agent' }
          : role === 'ask_question'
            ? { ask_id: 'ask-1', allow_freeform: false, questions: [] }
            : role === 'task_status'
              ? { task_id: 'task-1', status: 'running', importance: 'normal', summary: 'running' }
              : role === 'tool_call'
                ? { tool: 'shell', args: '{}', call_id: 'call-1' }
                : { call_id: 'call-1', ok: true, summary: 'ok' },
    created_at: 0,
  } as WsMessage;
}

test('agent activity includes non-text response messages', () => {
  const messages = [
    message(1, 'user_text'),
    message(2, 'task_status'),
    message(3, 'tool_call'),
    message(4, 'ask_question'),
  ];

  expect(getLatestAgentActivitySeq(messages)).toBe(4);
});

test('transcript omits tool_result rows (merged into tool_call UI later / no placeholder gap)', () => {
  const messages = [message(1, 'tool_call'), message(2, 'tool_result'), message(3, 'tool_call')];
  const visible = messages.filter(isRenderableInChatTranscript);
  expect(visible.map((m) => m.seq)).toEqual([1, 3]);
});

test('transcript keeps only the latest todo snapshot for a call id', () => {
  const todoSnapshot = (seq: number, status: string): WsMessage => ({
    type: 'message',
    seq,
    role: 'tool_call',
    payload: {
      tool: 'todo_list',
      args: JSON.stringify({ todos: [{ content: 'Fix card', status }] }),
      call_id: 'todo-1',
    },
    created_at: seq,
  });
  const messages = [
    todoSnapshot(1, 'pending'),
    message(2, 'agent_text'),
    todoSnapshot(3, 'in_progress'),
    todoSnapshot(4, 'completed'),
  ];

  expect(collapseTodoToolCallSnapshots(messages).map((m) => m.seq)).toEqual([2, 4]);
});

test('agent text sequence only tracks text responses', () => {
  const messages = [
    message(1, 'user_text'),
    message(2, 'task_status'),
    message(3, 'agent_text'),
    message(4, 'tool_call'),
  ];

  expect(getLatestAgentTextSeq(messages)).toBe(3);
});

/// System event render state: model changes appear in transcript but do not drive AI activity.
///
/// Data setup:
///   system_event seq = 3
///   payload.event = "model_changed"
///   labels = "Default" -> "Codex 5.3"
///
/// Execution:
///   1. Check transcript visibility for the event.
///   2. Check latest agent activity/text sequence using only this event.
///
/// Expected result:
///   - Positive: isRenderableInChatTranscript returns true.
///   - Negative: getLatestAgentActivitySeq returns 0, so typewriter/waiting state is not cleared.
///   - Negative: getLatestAgentTextSeq returns 0, so system events do not animate as text.
test('system_event messages render in chat transcript but do not count as agent activity', () => {
  const msg: WsMessage = {
    type: 'message',
    seq: 3,
    role: 'system_event',
    payload: {
      event: 'model_changed',
      from_model_id: null,
      to_model_id: 'gpt-5.3-codex',
      from_label: 'Default',
      to_label: 'Codex 5.3',
    },
    created_at: 10,
  };

  assertEqual(
    isRenderableInChatTranscript(msg),
    true,
    'system_event should remain visible in the chat transcript',
  );
  assertEqual(
    getLatestAgentActivitySeq([msg]),
    0,
    'system_event must not advance latest agent activity sequence',
  );
  assertEqual(
    getLatestAgentTextSeq([msg]),
    0,
    'system_event must not advance latest agent text sequence',
  );
});

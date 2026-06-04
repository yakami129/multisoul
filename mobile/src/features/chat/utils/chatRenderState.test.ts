import type { Conversation, WsMessage } from '@/types';
import {
  buildCompletedTranscriptDisplayItems,
  collapseTodoToolCallSnapshots,
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
  isRenderableInChatTranscript,
} from './chatRenderState';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) throw new Error(message);
  expect(actual).toBe(expected);
}

function message(
  seq: number,
  role: WsMessage['role'],
  overrides: Partial<WsMessage> = {},
): WsMessage {
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
    created_at: seq,
    ...overrides,
  } as WsMessage;
}

function displaySeqs(items: ReturnType<typeof buildCompletedTranscriptDisplayItems>) {
  return items.map((item) =>
    item.kind === 'message' ? item.message.seq : item.messages.map((m) => m.seq),
  );
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

test('completed transcript keeps final user and agent messages visible while folding prior work', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'agent_text', { created_at: 1_700_000_005_000 }),
    message(3, 'tool_call', { created_at: 1_700_000_010_000 }),
    message(4, 'system_event', { created_at: 1_700_000_015_000 }),
    message(5, 'ask_question', { answered: true, created_at: 1_700_000_020_000 }),
    message(6, 'user_text', { created_at: 1_700_000_025_000 }),
    message(7, 'agent_text', { created_at: 1_700_000_030_000 }),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'completed');

  expect(displaySeqs(items)).toEqual([[1, 2, 3, 4, 5], 6, 7]);
  expect(items[0]).toMatchObject({
    kind: 'worked',
    id: 'worked-1-5',
    label: 'Worked for 20s',
  });
});

test('completed transcript keeps unanswered questions visible and folds answered questions', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'ask_question', { answered: true, created_at: 1_700_000_001_000 }),
    message(3, 'tool_call', { created_at: 1_700_000_002_000 }),
    message(4, 'ask_question', { answered: false, created_at: 1_700_000_003_000 }),
    message(5, 'agent_text', { created_at: 1_700_000_004_000 }),
  ];

  expect(displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed'))).toEqual([
    1,
    [2, 3],
    4,
    5,
  ]);
});

test('completed transcript splits worked rows around visible unanswered questions', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'tool_call', { created_at: 1_700_000_010_000 }),
    message(3, 'ask_question', { answered: false, created_at: 1_700_000_020_000 }),
    message(4, 'tool_call', { created_at: 1_700_000_030_000 }),
    message(5, 'agent_text', { created_at: 1_700_000_040_000 }),
  ];

  expect(displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed'))).toEqual([
    1,
    [2],
    3,
    [4],
    5,
  ]);
});

test('completed transcript keeps terminal folded status before the final assistant answer', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'tool_call', { created_at: 1_700_000_010_000 }),
    message(3, 'agent_text', { created_at: 1_700_000_020_000 }),
    message(4, 'task_status', {
      payload: {
        task_id: 'task-1',
        status: 'completed',
        importance: 'normal',
        summary: 'done',
      },
      created_at: 1_700_000_030_000,
    }),
  ];

  expect(displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed'))).toEqual([
    1,
    [2, 4],
    3,
  ]);
});

test('completed transcript keeps pending questions after final assistant when originally later', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'tool_call', { created_at: 1_700_000_010_000 }),
    message(3, 'agent_text', { created_at: 1_700_000_020_000 }),
    message(4, 'ask_question', { answered: false, created_at: 1_700_000_030_000 }),
    message(5, 'task_status', {
      payload: {
        task_id: 'task-1',
        status: 'completed',
        importance: 'normal',
        summary: 'done',
      },
      created_at: 1_700_000_040_000,
    }),
  ];

  expect(displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed'))).toEqual([
    1,
    [2],
    3,
    4,
    [5],
  ]);
});

test('non-completed transcript statuses return renderable messages in original order', () => {
  const messages = [
    message(1, 'user_text'),
    message(2, 'tool_call'),
    message(3, 'tool_result'),
    message(4, 'agent_text'),
  ];
  const statuses: Conversation['status'][] = ['idle', 'running', 'awaiting_question', 'failed'];

  for (const status of statuses) {
    expect(displaySeqs(buildCompletedTranscriptDisplayItems(messages, status))).toEqual([1, 2, 4]);
  }
});

test('completed transcript omits robustly non-renderable tool result rows', () => {
  const messages = [
    message(1, 'tool_call'),
    message(2, 'tool_result'),
    message(3, 'user_text'),
    message(4, 'agent_text'),
  ];

  expect(displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed'))).toEqual([[1], 3, 4]);
});

test('worked duration label formats minutes and clamps sub-second ranges to one second', () => {
  const minuteItems = buildCompletedTranscriptDisplayItems(
    [
      message(1, 'tool_call', { created_at: 0 }),
      message(2, 'system_event', { created_at: 65_000 }),
      message(3, 'user_text', { created_at: 70_000 }),
      message(4, 'agent_text', { created_at: 75_000 }),
    ],
    'completed',
  );
  const subSecondItems = buildCompletedTranscriptDisplayItems(
    [
      message(1, 'tool_call', { created_at: 1000 }),
      message(2, 'system_event', { created_at: 1000.25 }),
      message(3, 'user_text', { created_at: 2000 }),
      message(4, 'agent_text', { created_at: 3000 }),
    ],
    'completed',
  );

  expect(minuteItems[0]).toMatchObject({ kind: 'worked', label: 'Worked for 1m 5s' });
  expect(subSecondItems[0]).toMatchObject({ kind: 'worked', label: 'Worked for 1s' });
});

test('completed transcript without folded messages has no worked row', () => {
  const messages = [message(1, 'user_text'), message(2, 'agent_text'), message(3, 'ask_question')];

  expect(buildCompletedTranscriptDisplayItems(messages, 'completed')).toEqual([
    { kind: 'message', message: messages[0] },
    { kind: 'message', message: messages[1] },
    { kind: 'message', message: messages[2] },
  ]);
});

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

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason: expect.any(String) });
}

function expectMatchObjectWithReason(actual: unknown, expected: unknown, reason: string) {
  expect({ actual, reason }).toMatchObject({ actual: expected, reason: expect.any(String) });
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

/// Multi-turn folding: completed transcripts split by user_text instead of one
/// global worked row.
///
/// Data construction:
///   turn 1 = seq 1 user, seq 2 tool_call, seq 3 final agent.
///   turn 2 = seq 4 user, seq 5 tool_call, seq 6 system_event, seq 7 final agent.
///
/// Execution process:
///   1. Build completed display items.
///   2. Verify each turn creates its own worked row.
///
/// Expected result:
///   - Positive: order is [1, worked[2], 3, 4, worked[5,6], 7].
///   - Negative: turn 1 process rows must not merge into turn 2 worked row.
test('completed transcript folds process messages per user turn instead of one global worked row', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'tool_call', { created_at: 1_700_000_005_000 }),
    message(3, 'agent_text', { created_at: 1_700_000_010_000 }),
    message(4, 'user_text', { created_at: 1_700_000_015_000 }),
    message(5, 'tool_call', { created_at: 1_700_000_020_000 }),
    message(6, 'system_event', { created_at: 1_700_000_025_000 }),
    message(7, 'agent_text', { created_at: 1_700_000_030_000 }),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'completed');

  expectEqualWithReason(
    displaySeqs(items),
    [1, [2], 3, 4, [5, 6], 7],
    'completed transcript should create independent worked rows per user turn',
  );
  expectMatchObjectWithReason(
    items[1],
    { kind: 'worked', messages: [messages[1]] },
    'first worked row should include only turn 1 process message seq 2',
  );
  expectMatchObjectWithReason(
    items[4],
    { kind: 'worked', messages: [messages[4], messages[5]] },
    'second worked row should include only turn 2 process messages seq 5 and 6',
  );
});

/// Ask-card visibility: answered and pending questions stay visible while one
/// worked row summarizes all hidden process rows in that turn.
///
/// Data construction:
///   seq 1 user; seq 2 progress agent; seq 3 answered ask; seq 4 tool_call.
///   seq 5 pending ask; seq 6 task_status; seq 7 final agent.
///   hidden duration = seq 2 at 5s through seq 6 at 25s => 20s.
///
/// Execution process:
///   1. Build completed display items for the single turn.
///   2. Check ask placement and hidden-message aggregation.
///
/// Expected result:
///   - Positive: asks seq 3 and 5 are top-level visible rows.
///   - Positive: one worked row contains seq 2, 4, and 6.
///   - Negative: asks are not hidden in the worked row.
test('completed turn keeps answered and pending questions visible while folding hidden process messages together', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'agent_text', { created_at: 1_700_000_005_000 }),
    message(3, 'ask_question', { answered: true, created_at: 1_700_000_010_000 }),
    message(4, 'tool_call', { created_at: 1_700_000_015_000 }),
    message(5, 'ask_question', { answered: false, created_at: 1_700_000_020_000 }),
    message(6, 'task_status', { created_at: 1_700_000_025_000 }),
    message(7, 'agent_text', { created_at: 1_700_000_030_000 }),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'completed');

  expectEqualWithReason(
    displaySeqs(items),
    [1, [2, 4, 6], 3, 5, 7],
    'completed turn should keep answered and pending questions visible after the worked row',
  );
  expectMatchObjectWithReason(
    items[1],
    {
      kind: 'worked',
      id: 'worked-2-6',
      label: 'Worked for 20s',
      messages: [messages[1], messages[3], messages[5]],
    },
    'worked row should summarize hidden process rows across the whole turn',
  );
  expectMatchObjectWithReason(
    items[2],
    { kind: 'message', message: messages[2] },
    'answered ask seq 3 should remain visible and not be folded',
  );
  expectMatchObjectWithReason(
    items[3],
    { kind: 'message', message: messages[4] },
    'pending ask seq 5 should remain visible and not be folded',
  );
});

/// Running guard: partial completed-looking turns stay fully visible unless the
/// whole conversation status is completed.
///
/// Data construction:
///   seq 1..3 look like a complete user/tool/agent turn.
///   seq 4..6 look like a second in-flight user/tool/agent turn.
///
/// Execution process:
///   1. Build display items with status = running.
///   2. Inspect the returned message rows.
///
/// Expected result:
///   - Positive: all renderable seqs stay visible in original order.
///   - Negative: no worked row is generated for earlier turns.
test('running transcript keeps earlier completed-looking turns unfolded', () => {
  const messages = [
    message(1, 'user_text'),
    message(2, 'tool_call'),
    message(3, 'agent_text'),
    message(4, 'user_text'),
    message(5, 'tool_call'),
    message(6, 'agent_text'),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'running');

  expectEqualWithReason(
    displaySeqs(items),
    [1, 2, 3, 4, 5, 6],
    'running transcript should return all renderable messages in original order',
  );
  expectEqualWithReason(
    items.some((item) => item.kind === 'worked'),
    false,
    'running transcript must not generate worked rows for prior turns',
  );
});

/// Single worked row with intervening asks: questions must not split one turn's
/// hidden work into multiple worked rows.
///
/// Data construction:
///   seq 1 user; seq 2 tool_call; seq 3 pending ask; seq 4 tool_call; seq 5 final agent.
///
/// Execution process:
///   1. Build completed display items.
///   2. Count worked rows and inspect hidden seqs.
///
/// Expected result:
///   - Positive: exactly one worked row contains seq 2 and 4.
///   - Negative: ask seq 3 does not create two separate worked rows.
test('completed transcript uses one worked row per turn even when questions interrupt process messages', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'tool_call', { created_at: 1_700_000_010_000 }),
    message(3, 'ask_question', { answered: false, created_at: 1_700_000_020_000 }),
    message(4, 'tool_call', { created_at: 1_700_000_030_000 }),
    message(5, 'agent_text', { created_at: 1_700_000_040_000 }),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'completed');

  expectEqualWithReason(
    displaySeqs(items),
    [1, [2, 4], 3, 5],
    'intervening ask should not split hidden process messages into multiple worked rows',
  );
  expectEqualWithReason(
    items.filter((item) => item.kind === 'worked').length,
    1,
    'each completed turn should have at most one worked row',
  );
});

/// Terminal status folding: task_status after the final agent is hidden before
/// the visible final answer, not displayed as a trailing row.
///
/// Data construction:
///   seq 1 user, seq 2 tool_call, seq 3 final agent, seq 4 completed task_status.
///
/// Execution process:
///   1. Build completed display items.
///   2. Inspect display order.
///
/// Expected result:
///   - Positive: seq 4 is hidden with seq 2 in the worked row.
///   - Negative: final agent seq 3 remains the visible turn result.
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

  expectEqualWithReason(
    displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed')),
    [1, [2, 4], 3],
    'terminal task_status should fold into worked row while final agent remains visible',
  );
});

/// Ask ordering: completed turns render ask cards before the final assistant
/// even if the ask arrived after an earlier agent_text.
///
/// Data construction:
///   seq 1 user, seq 2 tool_call, seq 3 final agent_text candidate.
///   seq 4 pending ask, seq 5 task_status; seq 3 is still the last agent_text.
///
/// Execution process:
///   1. Build completed display items.
///   2. Inspect turn display order.
///
/// Expected result:
///   - Positive: ask seq 4 is visible before final agent seq 3.
///   - Negative: task_status seq 5 is hidden in the worked row.
test('completed transcript displays ask cards before the final assistant within a completed turn', () => {
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

  expectEqualWithReason(
    displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed')),
    [1, [2, 5], 4, 3],
    'completed turn should render ask cards before the last agent_text result',
  );
});

/// Non-completed passthrough: only completed status may fold transcript rows.
///
/// Data construction:
///   seq 1 user, seq 2 tool_call, seq 3 tool_result, seq 4 agent.
///   tool_result is non-renderable, so passthrough display seqs are 1, 2, 4.
///
/// Execution process:
///   1. Build display items for idle, running, awaiting_question, and failed.
///   2. Inspect each status independently.
///
/// Expected result:
///   - Positive: every non-completed status returns seq 1, 2, 4.
///   - Negative: no non-completed status creates a worked row.
test('non-completed transcript statuses return renderable messages in original order', () => {
  const messages = [
    message(1, 'user_text'),
    message(2, 'tool_call'),
    message(3, 'tool_result'),
    message(4, 'agent_text'),
  ];
  const statuses: Conversation['status'][] = ['idle', 'running', 'awaiting_question', 'failed'];

  expectEqualWithReason(
    displaySeqs(buildCompletedTranscriptDisplayItems(messages, statuses[0])),
    [1, 2, 4],
    'idle transcript should pass through renderable messages without worked rows',
  );
  expectEqualWithReason(
    displaySeqs(buildCompletedTranscriptDisplayItems(messages, statuses[1])),
    [1, 2, 4],
    'running transcript should pass through renderable messages without worked rows',
  );
  expectEqualWithReason(
    displaySeqs(buildCompletedTranscriptDisplayItems(messages, statuses[2])),
    [1, 2, 4],
    'awaiting_question transcript should pass through renderable messages without worked rows',
  );
  expectEqualWithReason(
    displaySeqs(buildCompletedTranscriptDisplayItems(messages, statuses[3])),
    [1, 2, 4],
    'failed transcript should pass through renderable messages without worked rows',
  );
});

/// Tool-result omission: standalone tool_result rows stay non-renderable even
/// when completed folding is active.
///
/// Data construction:
///   seq 1 tool_call before any user, seq 2 tool_result, seq 3 user, seq 4 agent.
///
/// Execution process:
///   1. Build completed display items.
///   2. Inspect display seqs.
///
/// Expected result:
///   - Positive: seq 1, 3, and 4 remain renderable.
///   - Negative: tool_result seq 2 does not appear as a standalone item.
test('completed transcript omits robustly non-renderable tool result rows', () => {
  const messages = [
    message(1, 'tool_call'),
    message(2, 'tool_result'),
    message(3, 'user_text'),
    message(4, 'agent_text'),
  ];

  expectEqualWithReason(
    displaySeqs(buildCompletedTranscriptDisplayItems(messages, 'completed')),
    [1, 3, 4],
    'completed transcript should omit standalone tool_result rows',
  );
});

/// Worked duration formatting: duration is computed from hidden process rows in
/// the current turn and clamps sub-second ranges to one second.
///
/// Data construction:
///   minute hidden rows at 0ms and 65_000ms => 65s => "1m 5s".
///   sub-second hidden rows at 1000ms and 1000.25ms => <1s => "1s".
///
/// Execution process:
///   1. Build completed items for both cases.
///   2. Inspect the worked row labels.
///
/// Expected result:
///   - Positive: 65 seconds formats as "Worked for 1m 5s".
///   - Positive: sub-second hidden work formats as "Worked for 1s".
test('worked duration label formats minutes and clamps sub-second ranges to one second', () => {
  const minuteItems = buildCompletedTranscriptDisplayItems(
    [
      message(1, 'user_text', { created_at: 0 }),
      message(2, 'tool_call', { created_at: 0 }),
      message(3, 'system_event', { created_at: 65_000 }),
      message(4, 'agent_text', { created_at: 70_000 }),
    ],
    'completed',
  );
  const subSecondItems = buildCompletedTranscriptDisplayItems(
    [
      message(1, 'user_text', { created_at: 0 }),
      message(2, 'tool_call', { created_at: 1000 }),
      message(3, 'system_event', { created_at: 1000.25 }),
      message(4, 'agent_text', { created_at: 3000 }),
    ],
    'completed',
  );

  expectMatchObjectWithReason(
    minuteItems[1],
    { kind: 'worked', label: 'Worked for 1m 5s' },
    'worked label should format 65 hidden seconds as 1m 5s',
  );
  expectMatchObjectWithReason(
    subSecondItems[1],
    { kind: 'worked', label: 'Worked for 1s' },
    'worked label should clamp sub-second hidden duration to 1s',
  );
});

/// No hidden process rows: a completed turn with only user, ask, and final
/// agent does not render a worked row.
///
/// Data construction:
///   seq 1 user, seq 2 agent_text, seq 3 ask_question; no tool/status/process rows.
///
/// Execution process:
///   1. Build completed display items.
///   2. Inspect exact item list and worked-row count.
///
/// Expected result:
///   - Positive: user, ask, and final agent remain visible.
///   - Negative: no worked row is inserted when nothing is hidden.
test('completed transcript without hidden process messages has no worked row', () => {
  const messages = [message(1, 'user_text'), message(2, 'agent_text'), message(3, 'ask_question')];

  const items = buildCompletedTranscriptDisplayItems(messages, 'completed');

  expectEqualWithReason(
    items,
    [
      { kind: 'message', message: messages[0] },
      { kind: 'message', message: messages[2] },
      { kind: 'message', message: messages[1] },
    ],
    'completed turn without hidden process rows should only show user, ask, and final agent',
  );
  expectEqualWithReason(
    items.some((item) => item.kind === 'worked'),
    false,
    'completed turn without hidden process rows must not insert a worked row',
  );
});

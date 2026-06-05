import type { WsMessage } from '@/types';
import {
  isUserMessageModeAskQuestion,
  placeMsctlQuestionCardsAtBottom,
} from './msctlQuestionPlacement';

function msg(seq: number, role: WsMessage['role'], payload: WsMessage['payload']): WsMessage {
  return { type: 'message', seq, role, payload, created_at: seq };
}

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason: expect.any(String) });
}

/// msctl ask placement: response_mode=user_message cards are moved to the loaded
/// transcript tail without changing server seq or replacing row objects.
///
/// Data construction:
///   seq 1 = agent_text "before"
///   seq 2 = ask_question ask-msctl, response_mode=user_message
///   seq 3 = agent_text "after"
///   loaded window = [1, 2, 3], so only currently loaded rows participate
///
/// Execution process:
///   1. Build the loaded transcript messages in original server seq order.
///   2. Call placeMsctlQuestionCardsAtBottom(messages).
///   3. Inspect returned seq order and moved ask object identity.
///
/// Expected result:
///   - Positive: display order is 1, 3, 2, so the msctl ask is last.
///   - Positive: moved ask keeps seq=2 and the same object reference.
///   - Negative: moved ask does not remain in the original middle display position.
test('moves response-mode user-message ask_question to the loaded transcript tail', () => {
  const ask = msg(2, 'ask_question', {
    ask_id: 'ask-msctl',
    allow_freeform: false,
    response_mode: 'user_message',
    questions: [{ id: '0', text: 'Pick?', options: [{ id: 'yes', label: 'Yes' }] }],
  } as WsMessage['payload']);
  const messages = [
    msg(1, 'agent_text', { text: 'before' }),
    ask,
    msg(3, 'agent_text', { text: 'after' }),
  ];

  const placed = placeMsctlQuestionCardsAtBottom(messages);

  expectEqualWithReason(
    placed.map((m) => m.seq),
    [1, 3, 2],
    'msctl ask should be displayed after later regular transcript messages',
  );
  expectEqualWithReason(
    placed[2]?.seq,
    2,
    'moved msctl ask must preserve original seq=2 instead of mutating server order',
  );
  expectEqualWithReason(
    placed[2] === ask,
    true,
    'placement must preserve the original ask object identity for FlatList row state',
  );
  expectEqualWithReason(
    placed[1] === ask,
    false,
    'msctl ask must not remain in its original middle display position',
  );
});

/// msctl ask placement: multiple moved cards keep chronological order at the bottom.
///
/// Data construction:
///   seq 1 = ask_question ask-a, response_mode=user_message
///   seq 2 = agent_text regular row
///   seq 3 = ask_question ask-b, response_mode=user_message
///   seq 4 = user_text regular row
///
/// Execution process:
///   1. Build an interleaved loaded transcript window.
///   2. Call placeMsctlQuestionCardsAtBottom(messages).
///   3. Inspect the final display order and bottom-group ordering.
///
/// Expected result:
///   - Positive: regular messages stay in relative order 2, 4.
///   - Positive: msctl asks appear at the tail in original seq order 1, 3.
///   - Negative: newer ask-b must not jump ahead of older ask-a.
test('keeps multiple moved msctl cards sorted by original seq at the bottom', () => {
  const askA = msg(1, 'ask_question', {
    ask_id: 'ask-a',
    allow_freeform: false,
    response_mode: 'user_message',
    questions: [{ id: '0', text: 'A?', options: [] }],
  } as WsMessage['payload']);
  const askB = msg(3, 'ask_question', {
    ask_id: 'ask-b',
    allow_freeform: false,
    response_mode: 'user_message',
    questions: [{ id: '0', text: 'B?', options: [] }],
  } as WsMessage['payload']);
  const messages = [
    askA,
    msg(2, 'agent_text', { text: 'middle' }),
    askB,
    msg(4, 'user_text', { text: 'done' }),
  ];

  const placed = placeMsctlQuestionCardsAtBottom(messages);

  expectEqualWithReason(
    placed.map((m) => m.seq),
    [2, 4, 1, 3],
    'regular messages should stay first, followed by msctl asks in original seq order',
  );
  expectEqualWithReason(
    placed.slice(2).map((m) => m.seq),
    [1, 3],
    'bottom msctl card group should be sorted from older seq to newer seq',
  );
  expectEqualWithReason(
    placed[2] === askB,
    false,
    'newer msctl ask must not jump ahead of the older ask',
  );
});

/// msctl ask placement: ordinary ask_question cards are not moved, while the
/// predicate only matches msctl user-message-mode asks.
///
/// Data construction:
///   seq 1 = agent_text "before"
///   seq 2 = ordinary ask_question without response_mode=user_message
///   seq 3 = agent_text "after"
///   seq 4 = ask_question ask-msctl, response_mode=user_message
///
/// Execution process:
///   1. Build a loaded transcript containing a Claude-native ordinary ask card.
///   2. Check isUserMessageModeAskQuestion for ordinary ask and msctl ask.
///   3. Call placeMsctlQuestionCardsAtBottom(messages).
///
/// Expected result:
///   - Positive: ordinary ask remains in display seq order 1, 2, 3.
///   - Positive: predicate returns true for response_mode=user_message ask.
///   - Negative: predicate returns false for ordinary ask, so it is not appended after seq 3.
test('does not move ordinary ask_question cards without user-message response mode', () => {
  const ordinaryAsk = msg(2, 'ask_question', {
    ask_id: 'ask-claude',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy?', options: [] }],
  });
  const msctlAsk = msg(4, 'ask_question', {
    ask_id: 'ask-msctl',
    allow_freeform: false,
    response_mode: 'user_message',
    questions: [{ id: '0', text: 'Pick?', options: [] }],
  } as WsMessage['payload']);

  const placed = placeMsctlQuestionCardsAtBottom([
    msg(1, 'agent_text', { text: 'before' }),
    ordinaryAsk,
    msg(3, 'agent_text', { text: 'after' }),
  ]);

  expectEqualWithReason(
    placed.map((m) => m.seq),
    [1, 2, 3],
    'ordinary ask_question should keep its original visual position',
  );
  expectEqualWithReason(
    isUserMessageModeAskQuestion(msctlAsk),
    true,
    'predicate should identify msctl HTTP ask cards by response_mode=user_message',
  );
  expectEqualWithReason(
    isUserMessageModeAskQuestion(ordinaryAsk),
    false,
    'predicate must reject ordinary ask_question cards without user-message response mode',
  );
  expectEqualWithReason(
    placed[2] === ordinaryAsk,
    false,
    'ordinary ask_question must not be appended after later regular transcript messages',
  );
});

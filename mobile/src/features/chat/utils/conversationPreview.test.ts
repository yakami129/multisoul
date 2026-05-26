import {
  applyConversationPreviewMessage,
  getLatestConversationStatusFromTaskMessages,
  resolveConversationStatusFromMessageHistory,
} from '@/features/chat/utils/conversationPreview';
import type { Conversation, WsMessage } from '@/types';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) throw new Error(message);
  expect(actual).toBe(expected);
}

function assertNotEqual<T>(actual: T, expected: T, message: string) {
  if (Object.is(actual, expected)) throw new Error(message);
  expect(actual).not.toBe(expected);
}

describe('resolveConversationStatusFromMessageHistory', () => {
  it('returns running when transcript ends with user_text (never trust earlier task terminal)', () => {
    const tailUser: WsMessage[] = [
      {
        type: 'message',
        seq: 1,
        role: 'task_status',
        payload: {
          task_id: 't1',
          status: 'completed',
          importance: 'normal',
          summary: '',
        },
        created_at: 11,
      },
      {
        type: 'message',
        seq: 2,
        role: 'user_text',
        payload: { text: 'second turn' },
        created_at: 12,
      },
    ];
    expect(resolveConversationStatusFromMessageHistory(tailUser)).toBe('running');
  });

  it('returns awaiting_question when last row is unanswered ask_question', () => {
    expect(
      resolveConversationStatusFromMessageHistory([
        {
          type: 'message',
          seq: 1,
          role: 'task_status',
          payload: {
            task_id: 't',
            status: 'running',
            importance: 'normal',
            summary: '',
          },
          created_at: 10,
        },
        {
          type: 'message',
          seq: 2,
          role: 'ask_question',
          payload: {
            ask_id: 'q1',
            allow_freeform: false,
            questions: [{ id: 'q0', text: '?', options: [] }],
          },
          created_at: 11,
        },
      ]),
    ).toBe('awaiting_question');
  });

  it('delegates answered ask_question tails to task_status scan', () => {
    expect(
      resolveConversationStatusFromMessageHistory([
        {
          type: 'message',
          seq: 5,
          role: 'task_status',
          payload: {
            task_id: 't',
            status: 'completed',
            importance: 'normal',
            summary: '',
          },
          created_at: 20,
        },
        {
          type: 'message',
          seq: 6,
          role: 'ask_question',
          answered: true,
          payload: {
            ask_id: 'q1',
            allow_freeform: false,
            questions: [{ id: 'q0', text: '?', options: [] }],
          },
          created_at: 21,
        },
      ]),
    ).toBe('completed');
  });

  it('matches getLatestConversationStatusFromTaskMessages when last row is terminal task_status only', () => {
    const messages: WsMessage[] = [
      {
        type: 'message',
        seq: 1,
        role: 'task_status',
        payload: {
          task_id: 't1',
          status: 'completed',
          importance: 'normal',
          summary: '',
        },
        created_at: 11,
      },
    ];
    expect(resolveConversationStatusFromMessageHistory(messages)).toEqual(
      getLatestConversationStatusFromTaskMessages(messages),
    );
  });
});

describe('getLatestConversationStatusFromTaskMessages', () => {
  it('returns null when history has no task_status', () => {
    expect(
      getLatestConversationStatusFromTaskMessages([
        {
          type: 'message',
          seq: 1,
          role: 'user_text',
          payload: { text: 'hi' },
          created_at: 1,
        },
      ]),
    ).toBeNull();
  });

  it('returns the latest task_status by seq order', () => {
    const messages: WsMessage[] = [
      {
        type: 'message',
        seq: 1,
        role: 'task_status',
        payload: {
          task_id: 't1',
          status: 'running',
          importance: 'normal',
          summary: '',
        },
        created_at: 10,
      },
      {
        type: 'message',
        seq: 2,
        role: 'task_status',
        payload: {
          task_id: 't1',
          status: 'completed',
          importance: 'normal',
          summary: '',
        },
        created_at: 11,
      },
    ];
    expect(getLatestConversationStatusFromTaskMessages(messages)).toBe('completed');
  });
});

describe('applyConversationPreviewMessage', () => {
  /// System event preview: model changes refresh recency but never replace the AI summary.
  ///
  /// Data setup:
  ///   conversation.last_ai_reply = "previous assistant summary"
  ///   conversation.last_message_at = 10
  ///   system_event.created_at = 20
  ///
  /// Execution:
  ///   1. Apply a model_changed system event to the conversation preview.
  ///   2. Inspect last_message_at and last_ai_reply.
  ///
  /// Expected result:
  ///   - Positive: last_message_at becomes 20 so the chat can move to the top.
  ///   - Positive: model_id becomes the event to_model_id so other open clients refresh the header.
  ///   - Negative: last_ai_reply remains the previous assistant summary.
  ///   - Negative: last_ai_reply does not become the system event text.
  it('updates model_id but not last_ai_reply for model_changed system events', () => {
    const conversation: Conversation = {
      id: 'conv-1',
      agent_id: 'agent-1',
      title: 'Chat',
      created_at: 1,
      last_message_at: 10,
      status: 'completed',
      model_id: null,
      endpoint_id: 'endpoint-1',
      agent_name: 'Codex',
      first_user_message: 'hello',
      last_ai_reply: 'previous assistant summary',
    };
    const event: WsMessage = {
      type: 'message',
      seq: 9,
      role: 'system_event',
      payload: {
        event: 'model_changed',
        from_model_id: null,
        to_model_id: 'gpt-5.3-codex',
        from_label: 'Default',
        to_label: 'Codex 5.3',
      },
      created_at: 20,
    };

    const updated = applyConversationPreviewMessage(conversation, event);

    assertEqual(
      updated.last_message_at,
      20,
      'system_event should still refresh conversation recency',
    );
    assertEqual(
      updated.model_id,
      'gpt-5.3-codex',
      'model_changed system_event should refresh conversation.model_id for passive clients',
    );
    assertEqual(
      updated.last_ai_reply,
      'previous assistant summary',
      'system_event must preserve the previous assistant preview text',
    );
    assertNotEqual(
      updated.last_ai_reply,
      'Model changed: Default -> Codex 5.3',
      'system_event text must not replace last_ai_reply',
    );
  });
});

import {
  getLatestConversationStatusFromTaskMessages,
  resolveConversationStatusFromMessageHistory,
} from '@/features/chat/utils/conversationPreview';
import type { WsMessage } from '@/types';

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

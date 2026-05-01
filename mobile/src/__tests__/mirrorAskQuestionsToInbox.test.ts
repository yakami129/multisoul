import { mirrorAskQuestionsToInbox } from '@/features/inbox/utils/mirrorAskQuestionsToInbox';
import { type WsMessage } from '@/types';

const askMessage: WsMessage = {
  type: 'message',
  seq: 2,
  role: 'ask_question',
  payload: {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  created_at: 1000,
};

describe('mirrorAskQuestionsToInbox', () => {
  it('mirrors unanswered ask_question messages to inbox', async () => {
    const addItem = jest.fn().mockResolvedValue(undefined);

    await mirrorAskQuestionsToInbox({
      messages: [askMessage],
      endpoint_id: 'ep-1',
      agent_id: 'agent-1',
      agent_name: 'Deploy Bot',
      conversation_id: 'conv-1',
      addItem,
    });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ask-1',
        kind: 'pending_question',
        title: 'Deploy Bot',
        body: 'Deploy now?',
        received_at: 1000,
      }),
    );
  });

  it('does not mirror answered ask_question messages', async () => {
    const addItem = jest.fn().mockResolvedValue(undefined);

    await mirrorAskQuestionsToInbox({
      messages: [{ ...askMessage, answered: true }],
      endpoint_id: 'ep-1',
      agent_id: 'agent-1',
      conversation_id: 'conv-1',
      addItem,
    });

    expect(addItem).not.toHaveBeenCalled();
  });

  it('ignores non-question messages', async () => {
    const addItem = jest.fn().mockResolvedValue(undefined);

    await mirrorAskQuestionsToInbox({
      messages: [{ ...askMessage, role: 'agent_text', payload: { text: 'done' } }],
      endpoint_id: 'ep-1',
      agent_id: 'agent-1',
      conversation_id: 'conv-1',
      addItem,
    });

    expect(addItem).not.toHaveBeenCalled();
  });
});

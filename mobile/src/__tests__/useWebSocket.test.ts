import { buildAskQuestionInboxItem } from '@/features/inbox/utils/buildAskQuestionInboxItem';

describe('buildAskQuestionInboxItem', () => {
  const askPayload = {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [
      {
        id: '0',
        text: 'Need input?',
        options: [{ id: '0', label: 'Yes' }],
      },
    ],
  };

  it('prefers agent_name for inbox title', () => {
    const item = buildAskQuestionInboxItem({
      askPayload,
      endpoint_id: 'ep-1',
      agent_id: 'agent-123',
      agent_name: 'Release Bot',
      conversation_id: 'conv-1',
      received_at: 1,
    });

    expect(item.title).toBe('Release Bot');
    expect(item.body).toBe('Need input?');
  });

  it('falls back to agent_id when agent_name is empty', () => {
    const item = buildAskQuestionInboxItem({
      askPayload,
      endpoint_id: 'ep-1',
      agent_id: 'agent-123',
      agent_name: '   ',
      conversation_id: 'conv-1',
      received_at: 1,
    });

    expect(item.title).toBe('agent-123');
  });
});

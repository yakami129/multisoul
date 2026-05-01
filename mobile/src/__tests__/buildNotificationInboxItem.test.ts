import { buildNotificationInboxItem } from '@/features/inbox/utils/buildNotificationInboxItem';

const askPayload = {
  ask_id: 'ask-1',
  allow_freeform: false,
  questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
};

describe('buildNotificationInboxItem', () => {
  it('preserves ask_question payload from notification data JSON string', () => {
    const item = buildNotificationInboxItem({
      data: {
        inbox_id: 'ask-1',
        kind: 'pending_question',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        conversation_id: 'conv-1',
        payload: JSON.stringify(askPayload),
      },
      title: 'Deploy Bot',
      body: 'Deploy now?',
      received_at: 10,
    });

    expect(item).toMatchObject({
      id: 'ask-1',
      kind: 'pending_question',
      endpoint_id: 'ep-1',
      agent_id: 'agent-1',
      conversation_id: 'conv-1',
      payload: askPayload,
      received_at: 10,
    });
  });

  it('returns null when notification data has no inbox_id', () => {
    expect(
      buildNotificationInboxItem({
        data: { kind: 'pending_question' },
        title: 'Deploy Bot',
        body: 'Deploy now?',
      }),
    ).toBeNull();
  });

  it('keeps payload null for malformed notification payload data', () => {
    const item = buildNotificationInboxItem({
      data: {
        inbox_id: 'ask-1',
        kind: 'pending_question',
        payload: '{bad-json',
      },
      title: 'Deploy Bot',
      body: 'Deploy now?',
    });

    expect(item).toMatchObject({
      id: 'ask-1',
      kind: 'pending_question',
      payload: null,
    });
  });
});

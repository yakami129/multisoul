import { writeInboxItem } from '@/features/inbox/services/inboxService';

const mockRunAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('@/db', () => ({
  getDb: () => ({
    runAsync: mockRunAsync,
  }),
}));

describe('writeInboxItem', () => {
  beforeEach(() => {
    mockRunAsync.mockClear();
  });

  it('upserts existing inbox rows so a later ask_question payload repairs null notification rows', async () => {
    await writeInboxItem({
      id: 'ask-1',
      endpoint_id: 'ep-1',
      agent_id: 'agent-1',
      conversation_id: 'conv-1',
      kind: 'pending_question',
      title: 'Deploy Bot',
      body: 'Deploy now?',
      payload: {
        ask_id: 'ask-1',
        allow_freeform: false,
        questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
      },
      received_at: 2,
      read_at: null,
    });

    const sql = mockRunAsync.mock.calls[0][0] as string;
    const params = mockRunAsync.mock.calls[0][1] as unknown[];

    expect(sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(sql).not.toContain('INSERT OR IGNORE');
    expect(sql).toContain('payload = excluded.payload');
    expect(params[7]).toBe(
      JSON.stringify({
        ask_id: 'ask-1',
        allow_freeform: false,
        questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
      }),
    );
  });
});

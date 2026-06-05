import type { TranscriptItem } from '@/features/chat/types';
import type { WsMessage } from '@/types';
import { getAskId } from './chatMessageWindows';
import { getChatTranscriptDisplayItemKey } from './chatRenderState';
import { buildServerTranscriptDisplayItems } from './serverTranscriptDisplayItems';

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
        ? { text: `user ${seq}` }
        : role === 'agent_text'
          ? { text: `agent ${seq}` }
          : role === 'ask_question'
            ? { ask_id: `ask-${seq}`, allow_freeform: false, questions: [] }
            : role === 'tool_call'
              ? { tool: 'shell', args: '{}', call_id: `call-${seq}` }
              : role === 'task_status'
                ? { task_id: `task-${seq}`, status: 'running', importance: 'normal', summary: '' }
                : {
                    event: 'model_changed',
                    from_model_id: null,
                    to_model_id: null,
                    from_label: '',
                    to_label: '',
                  },
    created_at: seq,
    ...overrides,
  } as WsMessage;
}

function itemKeys(items: ReturnType<typeof buildServerTranscriptDisplayItems>): string[] {
  return items.map(getChatTranscriptDisplayItemKey);
}

describe('buildServerTranscriptDisplayItems', () => {
  it('maps a turn summary to user, stable server worked row, asks, and final agent', () => {
    const user = message(10, 'user_text');
    const ask = message(12, 'ask_question', {
      payload: { ask_id: 'ask-1', allow_freeform: false, questions: [] },
    });
    const finalAgent = message(19, 'agent_text');
    const pageItems: TranscriptItem[] = [
      {
        kind: 'turn_summary',
        turn_id: 'turn-10',
        start_seq: 10,
        end_seq: 19,
        user,
        worked: {
          id: 'worked-turn-10',
          label: 'Worked for 42s',
          duration_ms: 42_000,
          hidden_count: 4,
          first_hidden_seq: 11,
          last_hidden_seq: 18,
        },
        asks: [ask],
        final_agent: finalAgent,
      },
    ];

    const items = buildServerTranscriptDisplayItems(pageItems);

    expect(items).toMatchObject([
      { kind: 'message', message: user },
      {
        kind: 'server_worked',
        id: 'worked-turn-10',
        turnId: 'turn-10',
        label: 'Worked for 42s',
        hiddenCount: 4,
        messages: [],
      },
      { kind: 'message', message: ask },
      { kind: 'message', message: finalAgent },
    ]);
    expect(itemKeys(items)).toEqual(['message-10', 'worked-turn-10', 'message-12', 'message-19']);
    expect(items[1]).not.toHaveProperty('firstHiddenSeq', 11);
    expect(getAskId(items[2].kind === 'message' ? items[2].message : user)).toBe('ask-1');
  });

  it('uses worked turn id as the stable key instead of hidden seq range', () => {
    const items = buildServerTranscriptDisplayItems([
      {
        kind: 'turn_summary',
        turn_id: 'turn-30',
        start_seq: 30,
        end_seq: 40,
        user: message(30, 'user_text'),
        worked: {
          id: 'worked-31-39',
          label: 'Worked for 8s',
          duration_ms: 8_000,
          hidden_count: 2,
          first_hidden_seq: 31,
          last_hidden_seq: 39,
        },
        asks: [],
        final_agent: message(40, 'agent_text'),
      },
    ]);

    expect(itemKeys(items)).toContain('worked-turn-30');
    expect(itemKeys(items)).not.toContain('worked-31-39');
  });

  it('maps current raw and prelude raw messages in server order', () => {
    const preludeFirst = message(1, 'system_event');
    const preludeSecond = message(2, 'agent_text');
    const currentUser = message(20, 'user_text');
    const currentTool = message(21, 'tool_call');
    const pageItems: TranscriptItem[] = [
      { kind: 'prelude_raw', messages: [preludeFirst, preludeSecond] },
      {
        kind: 'current_turn_raw',
        turn_id: 'turn-20',
        start_seq: 20,
        messages: [currentUser, currentTool],
      },
    ];

    const items = buildServerTranscriptDisplayItems(pageItems);

    expect(items).toEqual([
      { kind: 'message', message: preludeFirst },
      { kind: 'message', message: preludeSecond },
      { kind: 'message', message: currentUser },
      { kind: 'message', message: currentTool },
    ]);
    expect(itemKeys(items)).toEqual(['message-1', 'message-2', 'message-20', 'message-21']);
  });
});

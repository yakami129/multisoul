import {
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
} from './chatRenderState';
import type { WsMessage } from '@/types';

function message(seq: number, role: WsMessage['role']): WsMessage {
  return {
    type: 'message',
    seq,
    role,
    payload: role === 'user_text'
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
    created_at: 0,
  } as WsMessage;
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

test('agent text sequence only tracks text responses', () => {
  const messages = [
    message(1, 'user_text'),
    message(2, 'task_status'),
    message(3, 'agent_text'),
    message(4, 'tool_call'),
  ];

  expect(getLatestAgentTextSeq(messages)).toBe(3);
});

import type { WsMessage } from '@/types';

export function getLatestAgentTextSeq(messages: WsMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'agent_text') {
      return messages[index].seq;
    }
  }
  return 0;
}

export function getLatestAgentActivitySeq(messages: WsMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user_text') {
      return messages[index].seq;
    }
  }
  return 0;
}

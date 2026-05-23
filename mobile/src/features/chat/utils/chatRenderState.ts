import type { WsMessage } from '@/types';

/** History rows omitted from transcript list (standalone bubble height 0; would duplicate ScrollView gaps). */
export function isRenderableInChatTranscript(msg: WsMessage): boolean {
  return msg.role !== 'tool_result';
}

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

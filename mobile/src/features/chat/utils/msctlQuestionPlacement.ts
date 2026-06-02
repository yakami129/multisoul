import type { AskQuestionPayload, WsMessage } from '@/types';

export function isUserMessageModeAskQuestion(msg: WsMessage): boolean {
  if (msg.role !== 'ask_question') {
    return false;
  }

  return (msg.payload as AskQuestionPayload).response_mode === 'user_message';
}

export function placeMsctlQuestionCardsAtBottom(messages: WsMessage[]): WsMessage[] {
  const regularMessages: WsMessage[] = [];
  const msctlAskMessages: WsMessage[] = [];

  for (const msg of messages) {
    if (isUserMessageModeAskQuestion(msg)) {
      msctlAskMessages.push(msg);
    } else {
      regularMessages.push(msg);
    }
  }

  if (msctlAskMessages.length === 0) {
    return messages;
  }

  return [...regularMessages, ...msctlAskMessages.sort((left, right) => left.seq - right.seq)];
}

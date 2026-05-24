import { type WsMessage } from '@/types';

export function getAskId(msg: WsMessage): string | undefined {
  return msg.role === 'ask_question' ? (msg.payload as { ask_id?: string }).ask_id : undefined;
}

export function hasAskId(messages: WsMessage[], askId: string): boolean {
  return messages.some((msg) => getAskId(msg) === askId);
}

export function getMaxMessageSeq(messages: WsMessage[]): number {
  return messages.reduce((maxSeq, msg) => Math.max(maxSeq, msg.seq), 0);
}

export function shouldMergeInitialHistory(current: WsMessage[], fetched: WsMessage[]): boolean {
  return getMaxMessageSeq(current) > getMaxMessageSeq(fetched);
}

export function hydrateAnswered(
  messages: WsMessage[],
  answeredMap: Map<string, { choice_id?: string; choice_ids?: Record<string, string> }>,
): WsMessage[] {
  return messages.map((m) => {
    if (m.role !== 'ask_question') return m;
    const askId = (m.payload as { ask_id?: string }).ask_id ?? '';
    const record = answeredMap.get(askId);
    return record
      ? {
          ...m,
          answered: true,
          answeredChoiceId: record.choice_id,
          answeredChoiceIds: record.choice_ids,
        }
      : m;
  });
}

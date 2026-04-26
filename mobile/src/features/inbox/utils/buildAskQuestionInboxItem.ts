import { AskQuestionPayload, InboxItem } from '@/types';

export function buildAskQuestionInboxItem(params: {
  askPayload: AskQuestionPayload;
  endpoint_id: string;
  agent_id: string;
  agent_name?: string;
  conversation_id: string;
  received_at?: number;
}): InboxItem {
  const { askPayload, endpoint_id, agent_id, agent_name, conversation_id, received_at } = params;
  const firstQ = askPayload.questions[0];
  const title = agent_name?.trim() || agent_id;

  return {
    id: askPayload.ask_id,
    endpoint_id,
    agent_id,
    conversation_id,
    kind: 'pending_question',
    title,
    body: firstQ?.text ?? '',
    payload: askPayload,
    received_at: received_at ?? Date.now(),
    read_at: null,
  };
}

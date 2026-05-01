import { type InboxItem, type WsMessage, type AskQuestionPayload } from '@/types';
import { buildAskQuestionInboxItem } from './buildAskQuestionInboxItem';

interface MirrorAskQuestionsToInboxArgs {
  messages: WsMessage[];
  endpoint_id: string;
  agent_id: string;
  agent_name?: string;
  conversation_id: string;
  addItem: (item: InboxItem) => Promise<void>;
}

export async function mirrorAskQuestionsToInbox({
  messages,
  endpoint_id,
  agent_id,
  agent_name,
  conversation_id,
  addItem,
}: MirrorAskQuestionsToInboxArgs): Promise<void> {
  const items = messages
    .filter((m) => m.role === 'ask_question' && !m.answered)
    .map((m) =>
      buildAskQuestionInboxItem({
        askPayload: m.payload as AskQuestionPayload,
        endpoint_id,
        agent_id,
        agent_name,
        conversation_id,
        received_at: m.created_at,
      }),
    );

  await Promise.all(items.map((item) => addItem(item)));
}

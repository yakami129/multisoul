import { useChatStore } from '@/store/chatStore';
import type { Conversation } from '@/types';

export interface ChatConversationSeed {
  id: string;
  endpointId?: string;
  agentId?: string;
  agentName?: string;
  /**
   * When provided, force the stored conversation to this status (used for
   * freshly-started server turns that are already running). When omitted, the
   * row is only inserted if missing and its status is left for the transcript
   * fetch / WebSocket stream to reconcile.
   */
  status?: Conversation['status'];
}

/**
 * Seed a conversation row into the chat store before navigating to Chat Detail.
 *
 * Flows that create a conversation server-side (spec idea interview, spec
 * implementation) must register it locally first; otherwise `updateConversation`
 * is a no-op, `conversationStatus` stays `idle`, and the Analyzing… waiting
 * bubble cannot reflect the running agent. Mirrors the Agents "new chat" seeding.
 */
export function seedChatConversation(seed: ChatConversationSeed): void {
  if (!seed.id) return;
  const { addConversation, updateConversation } = useChatStore.getState();
  const now = Date.now();
  addConversation({
    id: seed.id,
    agent_id: seed.agentId ?? '',
    title: '',
    created_at: now,
    last_message_at: now,
    status: seed.status ?? 'idle',
    model_id: null,
    endpoint_id: seed.endpointId ?? '',
    agent_name: seed.agentName ?? '',
  });
  if (seed.status) {
    updateConversation(seed.id, { status: seed.status });
  }
}

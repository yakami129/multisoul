import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { AgentDetail } from '../../../src/features/agents/components/AgentDetail';
import { fetchAgent } from '../../../src/features/agents/services/agentService';
import {
  createConversation,
  fetchConversations,
} from '../../../src/features/chat/services/chatService';
import { buildChatDetailPath } from '../../../src/features/chat/utils/chatRoutes';
import { useChatStore } from '../../../src/store/chatStore';
import { useEndpointStore } from '../../../src/store/endpointStore';
import { type Agent, type Conversation } from '../../../src/types';

export default function AgentDetailScreen() {
  const { id, endpoint_id } = useLocalSearchParams<{ id: string; endpoint_id: string }>();
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const addConversation = useChatStore((s) => s.addConversation);

  const [agent, setAgent] = useState<Agent | undefined>(undefined);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      setIsError(false);
      setAgent(undefined);
      setRecentConversations([]);

      if (!id) {
        setIsError(true);
        setIsLoading(false);
        return;
      }
      // Find the endpoint — prefer explicit endpoint_id param, else search all
      const ep = endpoint_id ? endpoints.find((e) => e.id === endpoint_id) : endpoints[0];
      if (!ep) {
        setIsError(true);
        setIsLoading(false);
        return;
      }

      let cancelled = false;

      fetchAgent(ep.base_url, ep.token, id, ep.id, ep.label)
        .then(async (a) => {
          if (cancelled) return;
          setAgent(a);
          let conversations: Conversation[] = [];
          try {
            conversations = await fetchConversations(ep.base_url, ep.token, id, ep.id, a.name);
          } catch {
            conversations = [];
          }
          if (cancelled) return;
          setRecentConversations(conversations);
          conversations.forEach(addConversation);
          setIsLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setIsError(true);
          setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [id, endpoint_id, endpoints, addConversation]),
  );

  const openConversation = (conversation: Conversation) => {
    router.push(
      buildChatDetailPath({
        conversationId: conversation.id,
        endpointId: conversation.endpoint_id,
        agentId: conversation.agent_id,
        agentName: conversation.agent_name,
      }),
    );
  };

  const handleNewChat = async () => {
    const ep_id = endpoint_id ?? agent?.endpoint_id ?? '';
    const ep = endpoints.find((e) => e.id === ep_id);
    if (!ep || !id) return;
    const conv = await createConversation(ep.base_url, ep.token, id, 'New Chat');
    // Seed the store so chat/[id] can find the conversation immediately.
    // Without this, updateConversation('running') in handleSend is a no-op,
    // the sync effect clears isAwaitingResponse, and the Analyzing… bubble never shows.
    const seeded = { ...conv, endpoint_id: ep_id, agent_name: agent?.name ?? '' };
    addConversation(seeded);
    setRecentConversations((current) => [seeded, ...current]);
    openConversation(seeded);
  };

  return (
    <AgentDetail
      agent={agent}
      recentConversations={recentConversations}
      isLoading={isLoading}
      isError={isError}
      onBack={() => router.back()}
      onNewChat={() => {
        void handleNewChat();
      }}
      onOpenConversation={openConversation}
    />
  );
}

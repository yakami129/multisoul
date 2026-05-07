import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AgentDetail } from '../../../src/features/agents/components/AgentDetail';
import { fetchAgent, invokeAgent } from '../../../src/features/agents/services/agentService';
import { createConversation } from '../../../src/features/chat/services/chatService';
import { buildChatDetailPath } from '../../../src/features/chat/utils/chatRoutes';
import { useChatStore } from '../../../src/store/chatStore';
import { useEndpointStore } from '../../../src/store/endpointStore';
import { type Agent } from '../../../src/types';

export default function AgentDetailScreen() {
  const { id, endpoint_id } = useLocalSearchParams<{ id: string; endpoint_id: string }>();
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const addConversation = useChatStore((s) => s.addConversation);

  const [agent, setAgent] = useState<Agent | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (!id) return;
    // Find the endpoint — prefer explicit endpoint_id param, else search all
    const ep = endpoint_id ? endpoints.find((e) => e.id === endpoint_id) : endpoints[0];
    if (!ep) {
      setIsError(true);
      setIsLoading(false);
      return;
    }

    fetchAgent(ep.base_url, ep.token, id, ep.id, ep.label)
      .then((a) => {
        setAgent(a);
        setIsLoading(false);
      })
      .catch(() => {
        setIsError(true);
        setIsLoading(false);
      });
  }, [id, endpoint_id, endpoints]);

  const handleInvoke = async (message: string): Promise<string> => {
    const ep = endpoint_id
      ? endpoints.find((e) => e.id === endpoint_id)
      : endpoints.find((e) => e.id === agent?.endpoint_id);
    if (!ep || !id) throw new Error('No endpoint');
    const conv_id = await invokeAgent(ep.base_url, ep.token, id, message);
    return conv_id;
  };

  const handleChat = async () => {
    const ep_id = endpoint_id ?? agent?.endpoint_id ?? '';
    const ep = endpoints.find((e) => e.id === ep_id);
    if (!ep || !id) return;
    const conv = await createConversation(ep.base_url, ep.token, id, 'New Chat');
    // Seed the store so chat/[id] can find the conversation immediately.
    // Without this, updateConversation('running') in handleSend is a no-op,
    // the sync effect clears isAwaitingResponse, and the Analyzing… bubble never shows.
    addConversation({ ...conv, endpoint_id: ep_id, agent_name: agent?.name ?? '' });
    router.push(
      buildChatDetailPath({
        conversationId: conv.id,
        endpointId: ep_id,
        agentId: id,
        agentName: agent?.name,
      }),
    );
  };

  return (
    <AgentDetail
      agent={agent}
      isLoading={isLoading}
      isError={isError}
      onBack={() => router.back()}
      onInvoke={handleInvoke}
      onChat={() => {
        void handleChat();
      }}
    />
  );
}

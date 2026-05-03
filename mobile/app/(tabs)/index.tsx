import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { createConversation } from '@/features/chat/services/chatService';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { AgentList } from '../../src/features/agents/components/AgentList';
import { fetchAllAgents } from '../../src/features/agents/services/agentService';
import { useEndpointStore } from '../../src/store/endpointStore';

export default function AgentListScreen() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['agents', endpoints.map((e) => e.id)],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  return (
    <AgentList
      agents={data ?? []}
      isLoading={isLoading}
      isError={isError}
      error={error}
      isFetching={isFetching}
      onRefetch={() => {
        void refetch();
      }}
      onAgentPress={(id, endpoint_id, name) => {
        const endpoint = endpoints.find((e) => e.id === endpoint_id);
        if (!endpoint) return;
        void createConversation(endpoint.base_url, endpoint.token, id, 'New Chat').then((conv) => {
          router.push(
            buildChatDetailPath({
              conversationId: conv.id,
              endpointId: endpoint_id,
              agentId: id,
              agentName: name,
            }),
          );
        });
      }}
    />
  );
}

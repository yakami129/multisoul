import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { AgentList } from '../../src/features/agents/components/AgentList';
import { fetchAllAgents } from '../../src/features/agents/services/agentService';
import { fetchConversations } from '../../src/features/chat/services/chatService';
import { AddEndpointModal } from '../../src/features/settings/components/AddEndpointModal';
import { useChatStore } from '../../src/store/chatStore';
import { useEndpointStore } from '../../src/store/endpointStore';

export default function AgentListScreen() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const addEndpoint = useEndpointStore((s) => s.addEndpoint);
  const mergeConversations = useChatStore((s) => s.mergeConversations);
  const [addEndpointVisible, setAddEndpointVisible] = React.useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['agents', endpoints.map((e) => e.id)],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  useFocusEffect(
    useCallback(() => {
      if (!data || data.length === 0) return;
      let cancelled = false;
      data.forEach((agent) => {
        const ep = endpoints.find((e) => e.id === agent.endpoint_id);
        if (!ep) return;
        fetchConversations(ep.base_url, ep.token, agent.id, ep.id, agent.name)
          .then((convs) => {
            if (!cancelled) mergeConversations(convs);
          })
          .catch(() => {});
      });
      return () => {
        cancelled = true;
      };
    }, [data, endpoints, mergeConversations]),
  );

  return (
    <>
      <AgentList
        agents={data ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        isFetching={isFetching}
        onRefetch={() => {
          void refetch();
        }}
        onAgentPress={(id, endpoint_id) => {
          router.push(
            `/agent/${encodeURIComponent(id)}?endpoint_id=${encodeURIComponent(endpoint_id)}`,
          );
        }}
        onAddEndpoint={() => setAddEndpointVisible(true)}
        onOpenWorkflows={() => router.push('/workflows')}
      />
      <AddEndpointModal
        visible={addEndpointVisible}
        initialTab="qr"
        onClose={() => setAddEndpointVisible(false)}
        onAdd={(label, base_url, token) => {
          void addEndpoint({ label, base_url, token });
        }}
      />
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { AgentList } from '../../src/features/agents/components/AgentList';
import { fetchAllAgents } from '../../src/features/agents/services/agentService';
import { AddEndpointModal } from '../../src/features/settings/components/AddEndpointModal';
import { useEndpointStore } from '../../src/store/endpointStore';

export default function AgentListScreen() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const addEndpoint = useEndpointStore((s) => s.addEndpoint);
  const [addEndpointVisible, setAddEndpointVisible] = React.useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['agents', endpoints.map((e) => e.id)],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

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

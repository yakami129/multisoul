import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { getApiClient } from '../../src/api';
import { AgentList } from '../../src/features/agents/components/AgentList';
import { fetchAgents } from '../../src/features/agents/services/agentService';

export default function AgentListScreen() {
  const router = useRouter();
  const client = getApiClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetchAgents(client),
    refetchInterval: 30_000,
  });

  return (
    <AgentList
      agents={data ?? []}
      isLoading={isLoading}
      isError={isError}
      error={error}
      isFetching={isFetching}
      onRefetch={refetch}
      onAgentPress={(id) => router.push(`/agent/${id}`)}
    />
  );
}

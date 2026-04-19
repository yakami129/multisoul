import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { getApiClient } from '../../../src/api';
import { AgentDetail } from '../../../src/features/agents/components/AgentDetail';
import { fetchAgent, invokeAgent } from '../../../src/features/agents/services/agentService';

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = getApiClient();

  const { data: agent, isLoading, isError } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => fetchAgent(client, id!),
    enabled: !!id,
  });

  return (
    <AgentDetail
      agent={agent}
      isLoading={isLoading}
      isError={isError}
      onBack={() => router.back()}
      onInvoke={() => invokeAgent(client, id!)}
      onChat={() => router.push(`/agent/${id}/chat`)}
    />
  );
}

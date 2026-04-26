import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AgentDetail } from '../../../src/features/agents/components/AgentDetail';
import { fetchAgent, invokeAgent } from '../../../src/features/agents/services/agentService';
import { useEndpointStore } from '../../../src/store/endpointStore';
import { type Agent } from '../../../src/types';

export default function AgentDetailScreen() {
  const { id, endpoint_id } = useLocalSearchParams<{ id: string; endpoint_id: string }>();
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);

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

  const handleChat = () => {
    const ep_id = endpoint_id ?? agent?.endpoint_id ?? '';
    const agent_name = encodeURIComponent(agent?.name ?? '');
    router.push(`/agent/${id}/chat?endpoint_id=${ep_id}&agent_name=${agent_name}`);
  };

  return (
    <AgentDetail
      agent={agent}
      isLoading={isLoading}
      isError={isError}
      onBack={() => router.back()}
      onInvoke={handleInvoke}
      onChat={handleChat}
    />
  );
}

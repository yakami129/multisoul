import { getEndpointClient } from '@/api/endpointClient';
import { type Agent } from '@/types';

export async function fetchAgentsFromEndpoint(
  base_url: string,
  token: string,
  endpoint_id: string,
  endpoint_label: string,
): Promise<Agent[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<Omit<Agent, 'endpoint_id' | 'endpoint_label'>[]>('/api/v1/agents');
  return res.data.map((a) => ({ ...a, endpoint_id, endpoint_label }));
}

export async function fetchAllAgents(
  endpoints: { id: string; label: string; base_url: string; token: string }[],
): Promise<Agent[]> {
  const results = await Promise.allSettled(
    endpoints.map((ep) => fetchAgentsFromEndpoint(ep.base_url, ep.token, ep.id, ep.label)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<Agent[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);
}

export async function fetchAgent(
  base_url: string,
  token: string,
  agent_id: string,
  endpoint_id: string,
  endpoint_label: string,
): Promise<Agent> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<Omit<Agent, 'endpoint_id' | 'endpoint_label'>>(
    `/api/v1/agents/${agent_id}`,
  );
  return { ...res.data, endpoint_id, endpoint_label };
}

export async function invokeAgent(
  base_url: string,
  token: string,
  agent_id: string,
  message: string,
): Promise<string> {
  const client = getEndpointClient(base_url, token);
  const res = await client.post<{ conversation_id: string }>(`/api/v1/agents/${agent_id}/invoke`, {
    message,
  });
  return res.data.conversation_id;
}

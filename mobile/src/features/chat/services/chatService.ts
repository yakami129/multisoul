import { Conversation, WsMessage } from '@/types';
import { getEndpointClient } from '@/api/endpointClient';

export async function fetchConversations(
  base_url: string, token: string, agent_id: string, endpoint_id: string, agent_name: string
): Promise<Conversation[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<Omit<Conversation, 'endpoint_id' | 'agent_name'>[]>(
    `/api/v1/agents/${agent_id}/conversations`
  );
  return res.data.map((c) => ({ ...c, endpoint_id, agent_name }));
}

export async function createConversation(
  base_url: string, token: string, agent_id: string, title: string
): Promise<Conversation> {
  const client = getEndpointClient(base_url, token);
  const res = await client.post<Conversation>(
    `/api/v1/agents/${agent_id}/conversations`, { title }
  );
  return res.data;
}

export async function fetchMessages(
  base_url: string, token: string, conv_id: string, since_seq?: number
): Promise<WsMessage[]> {
  const client = getEndpointClient(base_url, token);
  const params = since_seq != null ? { since_seq } : {};
  const res = await client.get<WsMessage[]>(
    `/api/v1/conversations/${conv_id}/messages`, { params }
  );
  return res.data;
}

export async function postMessage(
  base_url: string, token: string, conv_id: string, text: string
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  await client.post(`/api/v1/conversations/${conv_id}/messages`, { text });
}

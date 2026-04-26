import { Conversation, WsMessage } from '@/types';
import { getEndpointClient } from '@/api/endpointClient';

function buildConversationWsUrl(base_url: string, token: string, conv_id: string): string {
  const wsUrl = base_url.replace(/^https/, 'wss').replace(/^http/, 'ws');
  return `${wsUrl}/ws/conversations/${conv_id}?token=${token}`;
}

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

export async function sendConversationAnswer(
  base_url: string,
  token: string,
  conv_id: string,
  payload: {
    ask_id: string;
    choice_id?: string;
    choice_ids?: Record<string, string>;
    freeform?: string;
  }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(buildConversationWsUrl(base_url, token, conv_id));
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const cleanup = () => {
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.onmessage = null;
    };

    const timeout = setTimeout(() => {
      cleanup();
      try { ws.close(); } catch {}
      finish(() => reject(new Error('Timed out waiting for answer socket')));
    }, 10_000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'answer', ...payload }));
      clearTimeout(timeout);
      cleanup();
      try { ws.close(); } catch {}
      finish(resolve);
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      try { ws.close(); } catch {}
      finish(() => reject(new Error('Failed to open answer socket')));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      cleanup();
      if (!settled) finish(() => reject(new Error('Answer socket closed before sending')));
    };
  });
}

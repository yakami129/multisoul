import { AxiosInstance } from 'axios';
import { Agent } from '@/types';

export async function fetchAgents(client: AxiosInstance): Promise<Agent[]> {
  const res = await client.get<Agent[]>('/api/v1/agents');
  return res.data;
}

export async function fetchAgent(client: AxiosInstance, id: string): Promise<Agent> {
  const res = await client.get<Agent>(`/api/v1/agents/${id}`);
  return res.data;
}

export async function invokeAgent(client: AxiosInstance, id: string): Promise<string> {
  const res = await client.post(`/api/v1/agents/${id}/invoke`);
  const data = res.data;
  if (
    typeof data === 'object' &&
    Object.keys(data).length === 1 &&
    typeof Object.values(data)[0] === 'string'
  ) {
    return Object.values(data)[0] as string;
  }
  return JSON.stringify(data, null, 2);
}

import { getEndpointClient } from '@/api/endpointClient';
import { type DispatchSpecResult } from '../types';

export interface DispatchSpecPayload {
  title: string;
  slug: string;
  markdown: string;
}

export async function dispatchSpecToAgent(
  baseUrl: string,
  token: string,
  agentId: string,
  payload: DispatchSpecPayload,
): Promise<DispatchSpecResult> {
  const client = getEndpointClient(baseUrl, token);
  const res = await client.post<DispatchSpecResult>(
    `/api/v1/agents/${agentId}/specs/dispatch`,
    payload,
  );
  return res.data;
}

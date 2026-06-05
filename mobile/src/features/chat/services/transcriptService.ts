import { getEndpointClient } from '@/api/endpointClient';
import type { HiddenMessagesResponse, TranscriptPage } from '@/features/chat/types';

export interface FetchTranscriptTurnsOptions {
  limit?: number;
  beforeTurn?: string;
  aroundAskId?: string;
}

interface TranscriptTurnsQueryParams {
  limit?: number;
  before_turn?: string;
  around_ask_id?: string;
}

export async function fetchTranscriptTurns(
  base_url: string,
  token: string,
  conv_id: string,
  options: FetchTranscriptTurnsOptions = {},
): Promise<TranscriptPage> {
  const client = getEndpointClient(base_url, token);
  const params: TranscriptTurnsQueryParams = {};
  if (options.limit != null) params.limit = options.limit;
  if (options.beforeTurn) params.before_turn = options.beforeTurn;
  if (options.aroundAskId) params.around_ask_id = options.aroundAskId;

  const res = await client.get<TranscriptPage>(
    `/api/v1/conversations/${conv_id}/transcript-turns`,
    { params },
  );
  return res.data;
}

export async function fetchTurnHiddenMessages(
  base_url: string,
  token: string,
  conv_id: string,
  turn_id: string,
): Promise<HiddenMessagesResponse> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<HiddenMessagesResponse>(
    `/api/v1/conversations/${conv_id}/turns/${turn_id}/hidden-messages`,
  );
  return res.data;
}

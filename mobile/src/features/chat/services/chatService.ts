import { getEndpointClient } from '@/api/endpointClient';
import { type Conversation, type UserTextPayload, type WsMessage } from '@/types';

export interface AnswerAcknowledgement {
  ask_id: string;
  ok: boolean;
  error?: string;
  choice_id?: string;
  choice_ids?: Record<string, string>;
  freeform?: string;
}

export interface FetchMessagesOptions {
  since_seq?: number;
  limit?: number;
  before_seq?: number;
  around_ask_id?: string;
}

function buildConversationWsUrl(base_url: string, token: string, conv_id: string): string {
  const wsUrl = base_url.replace(/^https/, 'wss').replace(/^http/, 'ws');
  return `${wsUrl}/ws/conversations/${conv_id}?token=${token}`;
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function parseAnswerAcknowledgement(value: unknown): AnswerAcknowledgement | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  const askId = typeof envelope.ask_id === 'string' ? envelope.ask_id : '';
  if (!askId) return null;

  const type = typeof envelope.type === 'string' ? envelope.type : '';
  const isKnownAckType =
    type === 'answer_ack' ||
    type === 'answer_status' ||
    type === 'answer_result' ||
    type === 'answer_delivery' ||
    type === 'answer';
  if (!isKnownAckType) return null;

  const rawStatus = typeof envelope.status === 'string' ? envelope.status.toLowerCase() : '';
  const successStatus = new Set(['ok', 'success', 'succeeded', 'accepted', 'routed', 'persisted']);
  const failureStatus = new Set([
    'error',
    'failed',
    'failure',
    'rejected',
    'dropped',
    'no_session',
    'not_found',
  ]);

  let ok: boolean | null = null;
  if (typeof envelope.ok === 'boolean') ok = envelope.ok;
  if (typeof envelope.success === 'boolean') ok = envelope.success;
  if (typeof envelope.accepted === 'boolean') ok = envelope.accepted;
  if (rawStatus && successStatus.has(rawStatus)) ok = true;
  if (rawStatus && failureStatus.has(rawStatus)) ok = false;
  if (ok == null) return null;

  return {
    ask_id: askId,
    ok,
    error: typeof envelope.error === 'string' ? envelope.error : undefined,
    choice_id: typeof envelope.choice_id === 'string' ? envelope.choice_id : undefined,
    choice_ids: readStringMap(envelope.choice_ids),
    freeform: typeof envelope.freeform === 'string' ? envelope.freeform : undefined,
  };
}

export async function fetchConversations(
  base_url: string,
  token: string,
  agent_id: string,
  endpoint_id: string,
  agent_name: string,
): Promise<Conversation[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<Omit<Conversation, 'endpoint_id' | 'agent_name'>[]>(
    `/api/v1/agents/${agent_id}/conversations`,
  );
  return res.data.map((c) => ({ ...c, endpoint_id, agent_name }));
}

export async function createConversation(
  base_url: string,
  token: string,
  agent_id: string,
  title: string,
): Promise<Conversation> {
  const client = getEndpointClient(base_url, token);
  const res = await client.post<Conversation>(`/api/v1/agents/${agent_id}/conversations`, {
    title,
  });
  return res.data;
}

export async function fetchMessages(
  base_url: string,
  token: string,
  conv_id: string,
  options?: number | FetchMessagesOptions,
): Promise<WsMessage[]> {
  const client = getEndpointClient(base_url, token);
  const params: FetchMessagesOptions = {};
  if (typeof options === 'number') {
    params.since_seq = options;
  } else if (options) {
    if (options.since_seq != null) params.since_seq = options.since_seq;
    if (options.limit != null) params.limit = options.limit;
    if (options.before_seq != null) params.before_seq = options.before_seq;
    if (options.around_ask_id) params.around_ask_id = options.around_ask_id;
  }
  const res = await client.get<WsMessage[]>(`/api/v1/conversations/${conv_id}/messages`, {
    params,
  });
  return res.data;
}

export async function postMessage(
  base_url: string,
  token: string,
  conv_id: string,
  text: string,
  file_id?: string,
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  const body: { text: string; file_id?: string } = { text };
  if (file_id) body.file_id = file_id;
  await client.post(`/api/v1/conversations/${conv_id}/messages`, body);
}

export async function uploadImage(
  base_url: string,
  token: string,
  localUri: string,
): Promise<{ file_id: string }> {
  const client = getEndpointClient(base_url, token);

  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: 'image/jpeg',
    name: 'upload.jpg',
  } as unknown as Blob);

  const res = await client.post<{ file_id: string }>('/api/v1/uploads', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export function buildUploadedImageUrl(base_url: string, token: string, file_id: string): string {
  const base = base_url.replace(/\/$/, '');
  const encodedFileId = encodeURIComponent(file_id);
  const encodedToken = encodeURIComponent(token);
  return `${base}/api/v1/uploads/${encodedFileId}?token=${encodedToken}`;
}

export function resolveUserMessageImageUri(
  msg: WsMessage,
  base_url: string,
  token: string,
  localImageUris: ReadonlyMap<string, string>,
): string | undefined {
  if (msg.role !== 'user_text') return undefined;
  const fileId = (msg.payload as UserTextPayload).file_id;
  if (!fileId) return undefined;
  return localImageUris.get(fileId) ?? buildUploadedImageUrl(base_url, token, fileId);
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
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(buildConversationWsUrl(base_url, token, conv_id));
    let settled = false;
    let sent = false;

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
      try {
        ws.close();
      } catch {
        /* ignore close errors */
      }
      finish(() => reject(new Error('Timed out waiting for answer acknowledgement')));
    }, 10_000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'answer', ...payload }));
      sent = true;
    };

    ws.onmessage = (event) => {
      let ack: AnswerAcknowledgement | null = null;
      try {
        ack = parseAnswerAcknowledgement(JSON.parse(event.data as string));
      } catch {
        return;
      }
      if (!ack || ack.ask_id !== payload.ask_id) return;
      clearTimeout(timeout);
      cleanup();
      try {
        ws.close();
      } catch {
        /* ignore close errors */
      }
      if (ack.ok) {
        finish(resolve);
      } else {
        finish(() => reject(new Error(ack.error ?? 'Answer was rejected by server')));
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      try {
        ws.close();
      } catch {
        /* ignore close errors */
      }
      finish(() => reject(new Error('Failed to open answer socket')));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      cleanup();
      if (!settled) {
        finish(() =>
          reject(
            new Error(
              sent
                ? 'Answer socket closed before acknowledgement'
                : 'Answer socket closed before sending',
            ),
          ),
        );
      }
    };
  });
}

export async function deleteConversation(
  base_url: string,
  token: string,
  conv_id: string,
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  await client.delete(`/api/v1/conversations/${conv_id}`);
}

export async function abortConversation(
  base_url: string,
  token: string,
  conv_id: string,
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  await client.post(`/api/v1/conversations/${conv_id}/abort`, {});
}

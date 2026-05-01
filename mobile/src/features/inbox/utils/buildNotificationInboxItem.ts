import { type AskQuestionPayload, type InboxItem, type InboxKind } from '@/types';

interface BuildNotificationInboxItemArgs {
  data: Record<string, unknown>;
  title: string;
  body: string;
  received_at?: number;
}

const INBOX_KINDS: InboxKind[] = ['pending_question', 'complex_done', 'complex_failed'];

export function buildNotificationInboxItem({
  data,
  title,
  body,
  received_at,
}: BuildNotificationInboxItemArgs): InboxItem | null {
  const inbox_id = asString(data.inbox_id);
  if (!inbox_id) return null;

  const rawKind = asString(data.kind);
  const kind = INBOX_KINDS.includes(rawKind as InboxKind) ? (rawKind as InboxKind) : 'complex_done';

  return {
    id: inbox_id,
    endpoint_id: asString(data.endpoint_id) ?? '',
    agent_id: asString(data.agent_id) ?? '',
    conversation_id: asString(data.conversation_id) ?? '',
    kind,
    title,
    body,
    payload: parseAskPayload(data.payload),
    received_at: received_at ?? Date.now(),
    read_at: null,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseAskPayload(value: unknown): AskQuestionPayload | null {
  if (!value) return null;
  if (typeof value === 'object') return value as AskQuestionPayload;
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value) as AskQuestionPayload;
  } catch {
    return null;
  }
}

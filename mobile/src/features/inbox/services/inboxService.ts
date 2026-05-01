import { getDb } from '@/db';
import { type InboxItem, type InboxKind, type AskQuestionPayload } from '@/types';

export async function writeInboxItem(item: InboxItem): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT INTO inbox
     (id, endpoint_id, agent_id, conversation_id, kind, title, body, payload, received_at, read_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(id) DO UPDATE SET
       endpoint_id = excluded.endpoint_id,
       agent_id = excluded.agent_id,
       conversation_id = excluded.conversation_id,
       kind = excluded.kind,
       title = excluded.title,
       body = excluded.body,
       payload = excluded.payload,
       received_at = excluded.received_at`,
    [
      item.id,
      item.endpoint_id,
      item.agent_id,
      item.conversation_id,
      item.kind,
      item.title,
      item.body,
      item.payload ? JSON.stringify(item.payload) : null,
      item.received_at,
    ],
  );
}

export async function loadInboxItems(): Promise<InboxItem[]> {
  const db = getDb();
  interface InboxRow {
    id: string;
    endpoint_id: string;
    agent_id: string;
    conversation_id: string;
    kind: string;
    title: string;
    body: string;
    payload: string | null;
    received_at: number;
    read_at: number | null;
  }
  const rows = await db.getAllAsync<InboxRow>('SELECT * FROM inbox ORDER BY received_at DESC');
  return rows.map((r) => ({
    ...r,
    kind: r.kind as InboxKind,
    payload: r.payload ? (JSON.parse(r.payload) as AskQuestionPayload) : null,
  }));
}

export async function markRead(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('UPDATE inbox SET read_at = ? WHERE id = ?', [Date.now(), id]);
}

export async function deleteInboxItem(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM inbox WHERE id = ?', [id]);
}

export async function markAskAnswered(
  ask_id: string,
  conversation_id: string,
  choice_id?: string,
  choice_ids?: Record<string, string>,
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    'INSERT OR IGNORE INTO answered_asks (ask_id, conversation_id, answered_at, choice_id, choice_ids) VALUES (?,?,?,?,?)',
    [
      ask_id,
      conversation_id,
      Date.now(),
      choice_id ?? null,
      choice_ids ? JSON.stringify(choice_ids) : null,
    ],
  );
}

export interface AnsweredAskRecord {
  choice_id?: string;
  choice_ids?: Record<string, string>;
}

export async function loadAnsweredAsks(
  conversation_id: string,
): Promise<Map<string, AnsweredAskRecord>> {
  const db = getDb();
  const rows = await db.getAllAsync<{
    ask_id: string;
    choice_id: string | null;
    choice_ids: string | null;
  }>('SELECT ask_id, choice_id, choice_ids FROM answered_asks WHERE conversation_id = ?', [
    conversation_id,
  ]);
  const map = new Map<string, AnsweredAskRecord>();
  for (const r of rows) {
    map.set(r.ask_id, {
      choice_id: r.choice_id ?? undefined,
      choice_ids: r.choice_ids ? (JSON.parse(r.choice_ids) as Record<string, string>) : undefined,
    });
  }
  return map;
}

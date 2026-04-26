import { InboxItem } from '@/types';
import { getDb } from '@/db';

export async function writeInboxItem(item: InboxItem): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO inbox
     (id, endpoint_id, agent_id, conversation_id, kind, title, body, payload, received_at, read_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
    [
      item.id, item.endpoint_id, item.agent_id, item.conversation_id,
      item.kind, item.title, item.body,
      item.payload ? JSON.stringify(item.payload) : null,
      item.received_at,
    ]
  );
}

export async function loadInboxItems(): Promise<InboxItem[]> {
  const db = getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM inbox ORDER BY received_at DESC'
  );
  return rows.map((r) => ({
    ...r,
    payload: r.payload ? JSON.parse(r.payload) : null,
  }));
}

export async function markRead(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('UPDATE inbox SET read_at = ? WHERE id = ?', [Date.now(), id]);
}

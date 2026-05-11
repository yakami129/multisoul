import { create } from 'zustand';
import {
  loadInboxItems,
  writeInboxItem,
  markRead,
  deleteInboxItem,
} from '@/features/inbox/services/inboxService';
import { type InboxItem } from '@/types';

interface InboxState {
  items: InboxItem[];
  load: () => Promise<void>;
  addItem: (item: InboxItem) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set) => ({
  items: [],

  load: async () => {
    const rows = await loadInboxItems();
    // Deduplicate by id in case of DB anomalies or concurrent writes
    const seen = new Set<string>();
    const items = rows.filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
    set({ items });
  },

  addItem: async (item) => {
    await writeInboxItem(item);
    set((s) => {
      if (s.items.some((i) => i.id === item.id)) return s;
      return { items: [item, ...s.items] };
    });
  },

  markRead: async (id) => {
    await markRead(id);
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, read_at: Date.now() } : i)),
    }));
  },

  // Remove an item from the inbox by ID
  removeItem: async (id) => {
    await deleteInboxItem(id);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
}));

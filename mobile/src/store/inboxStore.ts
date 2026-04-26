import { create } from 'zustand';
import { InboxItem } from '@/types';
import { loadInboxItems, writeInboxItem, markRead } from '@/features/inbox/services/inboxService';

interface InboxState {
  items: InboxItem[];
  load: () => Promise<void>;
  addItem: (item: InboxItem) => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set) => ({
  items: [],

  load: async () => {
    const items = await loadInboxItems();
    set({ items });
  },

  addItem: async (item) => {
    await writeInboxItem(item);
    set((s) => ({ items: [item, ...s.items] }));
  },

  markRead: async (id) => {
    await markRead(id);
    set((s) => ({
      items: s.items.map((i) => i.id === id ? { ...i, read_at: Date.now() } : i),
    }));
  },
}));

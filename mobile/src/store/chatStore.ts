import { create } from 'zustand';
import { type Conversation, type WsMessage } from '@/types';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, WsMessage[]>;
  setConversations: (convs: Conversation[]) => void;
  removeConversation: (id: string) => void;
  restoreConversation: (conv: Conversation, index: number) => void;
  appendMessage: (conv_id: string, msg: WsMessage) => void;
  setMessages: (conv_id: string, msgs: WsMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  messages: {},
  setConversations: (conversations) => set({ conversations }),
  removeConversation: (id) =>
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),
  restoreConversation: (conv, index) =>
    set((s) => {
      const next = [...s.conversations];
      next.splice(index, 0, conv);
      return { conversations: next };
    }),
  appendMessage: (conv_id, msg) =>
    set((s) => {
      const existing = s.messages[conv_id] ?? [];
      if (existing.some((m) => m.seq === msg.seq)) return s;
      return { messages: { ...s.messages, [conv_id]: [...existing, msg] } };
    }),
  setMessages: (conv_id, msgs) => set((s) => ({ messages: { ...s.messages, [conv_id]: msgs } })),
}));

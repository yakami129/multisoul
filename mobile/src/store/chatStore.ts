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
  markAnswered: (
    conv_id: string,
    ask_id: string,
    choice_id?: string,
    choice_ids?: Record<string, string>,
  ) => void;
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
  markAnswered: (conv_id, ask_id, choice_id, choice_ids) =>
    set((s) => {
      const existing = s.messages[conv_id];
      if (!existing) return s;
      const updated = existing.map((m) =>
        m.role === 'ask_question' && (m.payload as { ask_id?: string }).ask_id === ask_id
          ? { ...m, answered: true, answeredChoiceId: choice_id, answeredChoiceIds: choice_ids }
          : m,
      );
      return { messages: { ...s.messages, [conv_id]: updated } };
    }),
}));

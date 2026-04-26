import { create } from 'zustand';
import { type Conversation, type WsMessage } from '@/types';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, WsMessage[]>;
  setConversations: (convs: Conversation[]) => void;
  appendMessage: (conv_id: string, msg: WsMessage) => void;
  setMessages: (conv_id: string, msgs: WsMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  messages: {},
  setConversations: (conversations) => set({ conversations }),
  appendMessage: (conv_id, msg) =>
    set((s) => {
      const existing = s.messages[conv_id] ?? [];
      if (existing.some((m) => m.seq === msg.seq)) return s;
      return {
        messages: {
          ...s.messages,
          [conv_id]: [...existing, msg],
        },
      };
    }),
  setMessages: (conv_id, msgs) => set((s) => ({ messages: { ...s.messages, [conv_id]: msgs } })),
}));

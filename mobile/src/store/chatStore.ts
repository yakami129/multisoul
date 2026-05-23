import { create } from 'zustand';
import {
  applyConversationPreviewMessage,
  applyConversationPreviewMessages,
  resolveConversationStatusFromMessageHistory,
} from '@/features/chat/utils/conversationPreview';
import { type Conversation, type TaskStatusPayload, type WsMessage } from '@/types';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, WsMessage[]>;
  setConversations: (convs: Conversation[]) => void;
  addConversation: (conv: Conversation) => void;
  updateConversation: (id: string, patch: Partial<Conversation>) => void;
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
  addConversation: (conv) =>
    set((s) => {
      if (s.conversations.some((c) => c.id === conv.id)) return s;
      return { conversations: [conv, ...s.conversations] };
    }),
  updateConversation: (id, patch) =>
    set((s) => ({
      conversations: s.conversations.map((conv) => (conv.id === id ? { ...conv, ...patch } : conv)),
    })),
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
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          let next = applyConversationPreviewMessage(conv, msg);
          if (msg.role === 'task_status' && msg.payload) {
            const st = (msg.payload as TaskStatusPayload).status;
            if (st === 'running' || st === 'completed' || st === 'failed') {
              next = { ...next, status: st };
            }
          }
          return next;
        }),
        messages: { ...s.messages, [conv_id]: [...existing, msg] },
      };
    }),
  setMessages: (conv_id, msgs) =>
    set((s) => {
      const fromMsgs = resolveConversationStatusFromMessageHistory(msgs);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          let next = applyConversationPreviewMessages(conv, msgs);
          if (fromMsgs != null) {
            next = { ...next, status: fromMsgs };
          }
          return next;
        }),
        messages: { ...s.messages, [conv_id]: msgs },
      };
    }),
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

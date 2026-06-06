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
  mergeConversations: (convs: Conversation[]) => void;
  updateConversation: (id: string, patch: Partial<Conversation>) => void;
  removeConversation: (id: string) => void;
  restoreConversation: (conv: Conversation, index: number) => void;
  appendMessage: (conv_id: string, msg: WsMessage) => void;
  setMessages: (conv_id: string, msgs: WsMessage[]) => void;
  mergeMessages: (conv_id: string, msgs: WsMessage[]) => void;
  prependMessages: (conv_id: string, msgs: WsMessage[]) => void;
  resetMessages: (conv_id: string, msgs: WsMessage[]) => void;
  markAnswered: (
    conv_id: string,
    ask_id: string,
    choice_id?: string,
    choice_ids?: Record<string, string>,
  ) => void;
}

function dedupeAndSortMessages(messages: WsMessage[]): WsMessage[] {
  const bySeq = new Map<number, WsMessage>();
  for (const message of messages) {
    if (!bySeq.has(message.seq)) {
      bySeq.set(message.seq, message);
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function applyMessageHistory(conversation: Conversation, messages: WsMessage[]): Conversation {
  const fromMsgs = resolveConversationStatusFromMessageHistory(messages);
  const fromWindow = applyConversationPreviewMessages(
    { ...conversation, first_user_message: undefined, last_ai_reply: undefined },
    messages,
  );
  let next = {
    ...fromWindow,
    first_user_message: fromWindow.first_user_message ?? conversation.first_user_message,
    last_ai_reply: fromWindow.last_ai_reply ?? conversation.last_ai_reply,
  };
  if (fromMsgs != null) {
    next = { ...next, status: fromMsgs };
  }
  return next;
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
  mergeConversations: (convs) =>
    set((s) => {
      const freshById = new Map(convs.map((c) => [c.id, c]));
      const updated = s.conversations.map((c) => freshById.get(c.id) ?? c);
      const existingIds = new Set(s.conversations.map((c) => c.id));
      const brandNew = convs.filter((c) => !existingIds.has(c.id));
      return { conversations: [...brandNew, ...updated] };
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
      const nextMessages = dedupeAndSortMessages(msgs);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          return applyMessageHistory(conv, nextMessages);
        }),
        messages: { ...s.messages, [conv_id]: nextMessages },
      };
    }),
  mergeMessages: (conv_id, msgs) =>
    set((s) => {
      const nextMessages = dedupeAndSortMessages([...(s.messages[conv_id] ?? []), ...msgs]);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          return applyMessageHistory(conv, nextMessages);
        }),
        messages: { ...s.messages, [conv_id]: nextMessages },
      };
    }),
  prependMessages: (conv_id, msgs) =>
    set((s) => {
      const nextMessages = dedupeAndSortMessages([...(s.messages[conv_id] ?? []), ...msgs]);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          return applyMessageHistory(conv, nextMessages);
        }),
        messages: { ...s.messages, [conv_id]: nextMessages },
      };
    }),
  resetMessages: (conv_id, msgs) =>
    set((s) => {
      const nextMessages = dedupeAndSortMessages(msgs);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          return applyMessageHistory(conv, nextMessages);
        }),
        messages: { ...s.messages, [conv_id]: nextMessages },
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

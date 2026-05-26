import {
  type AgentTextPayload,
  type Conversation,
  type SystemEventPayload,
  type TaskStatusPayload,
  type UserTextPayload,
  type WsMessage,
} from '@/types';

function cleanText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

export function conversationDisplayTitle(conversation: Conversation): string {
  return cleanText(conversation.first_user_message) ?? conversation.title;
}

export function conversationDisplaySummary(conversation: Conversation): string {
  return (
    cleanText(conversation.last_ai_reply) ??
    cleanText(conversation.first_user_message) ??
    conversation.title
  );
}

export function applyConversationPreviewMessage(
  conversation: Conversation,
  message: WsMessage,
): Conversation {
  let next = conversation;
  const last_message_at = Math.max(conversation.last_message_at, message.created_at);

  if (last_message_at !== conversation.last_message_at) {
    next = { ...next, last_message_at };
  }

  if (message.role === 'system_event') {
    const payload = message.payload as SystemEventPayload;
    if (payload.event === 'model_changed' && payload.to_model_id !== conversation.model_id) {
      next = { ...next, model_id: payload.to_model_id };
    }
    return next;
  }

  if (message.role === 'user_text') {
    const text = cleanText((message.payload as UserTextPayload).text);
    if (text && !cleanText(conversation.first_user_message)) {
      next = { ...next, first_user_message: text };
    }
  }

  if (message.role === 'agent_text') {
    const text = cleanText((message.payload as AgentTextPayload).text);
    if (text && text !== conversation.last_ai_reply) {
      next = { ...next, last_ai_reply: text };
    }
  }

  return next;
}

export function applyConversationPreviewMessages(
  conversation: Conversation,
  messages: WsMessage[],
): Conversation {
  return messages.reduce(applyConversationPreviewMessage, conversation);
}

/** Last matching `task_status` in message order reflects the server's task state after history load/catch-up. */
export function getLatestConversationStatusFromTaskMessages(
  messages: WsMessage[],
): Conversation['status'] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const m = messages[index];
    if (m.role !== 'task_status' || m.payload == null) continue;
    const st = (m.payload as TaskStatusPayload).status;
    if (st === 'running' || st === 'completed' || st === 'failed') {
      return st;
    }
  }
  return null;
}

/**
 * Conversation.status when replacing the **full** message list (REST catch-up).
 *
 * Guards against a stale final `task_status` from an **earlier turn** — e.g. after the user sends
 * again, history may temporarily end with `user_text` while the last streamed `task_status` is still
 * `completed` until the runtime emits updates for the new turn.
 *
 * Keeps parity with transient WS-driven states (`awaiting_question` when the transcript ends on an
 * unanswered question card).
 */
export function resolveConversationStatusFromMessageHistory(
  messages: WsMessage[],
): Conversation['status'] | null {
  if (messages.length === 0) return null;

  const last = messages[messages.length - 1];
  if (last.role === 'ask_question') {
    if (!last.answered) return 'awaiting_question';
    return getLatestConversationStatusFromTaskMessages(messages);
  }
  if (last.role === 'user_text') {
    return 'running';
  }

  return getLatestConversationStatusFromTaskMessages(messages);
}

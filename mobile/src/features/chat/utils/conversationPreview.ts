import {
  type AgentTextPayload,
  type Conversation,
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

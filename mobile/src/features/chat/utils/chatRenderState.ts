import type { Conversation, UserTextPayload, WsMessage } from '@/types';

export type ChatTranscriptDisplayItem =
  | { kind: 'message'; message: WsMessage }
  | { kind: 'user_image_group'; id: string; messages: WsMessage[] }
  | { kind: 'worked'; id: string; label: string; messages: WsMessage[] }
  | {
      kind: 'server_worked';
      id: string;
      turnId: string;
      label: string;
      hiddenCount: number;
      messages: WsMessage[];
      isLoading?: boolean;
    };

export function getChatTranscriptDisplayItemKey(item: ChatTranscriptDisplayItem): string {
  return item.kind === 'message' ? `message-${item.message.seq}` : item.id;
}

function isUserImageMessage(msg: WsMessage): boolean {
  return msg.role === 'user_text' && !!(msg.payload as UserTextPayload).file_id;
}

function userImageMessagesFromItem(item: ChatTranscriptDisplayItem): WsMessage[] | null {
  if (item.kind === 'user_image_group') return item.messages;
  if (item.kind === 'message' && isUserImageMessage(item.message)) return [item.message];
  return null;
}

export function groupAdjacentUserImageMessages(
  items: ChatTranscriptDisplayItem[],
): ChatTranscriptDisplayItem[] {
  const grouped: ChatTranscriptDisplayItem[] = [];
  let imageMessages: WsMessage[] = [];

  function flushImageMessages() {
    if (imageMessages.length === 1) {
      grouped.push({ kind: 'message', message: imageMessages[0] });
    } else if (imageMessages.length > 1) {
      const firstSeq = imageMessages[0].seq;
      const lastSeq = imageMessages[imageMessages.length - 1].seq;
      grouped.push({
        kind: 'user_image_group',
        id: `user-images-${firstSeq}-${lastSeq}`,
        messages: imageMessages,
      });
    }
    imageMessages = [];
  }

  for (const item of items) {
    const itemImageMessages = userImageMessagesFromItem(item);
    if (itemImageMessages) {
      imageMessages.push(...itemImageMessages);
      continue;
    }
    flushImageMessages();
    grouped.push(item);
  }
  flushImageMessages();

  return grouped;
}

function isTodoToolCall(msg: WsMessage): boolean {
  if (msg.role !== 'tool_call') return false;
  const payload = msg.payload as { tool?: unknown };
  const tool = typeof payload.tool === 'string' ? payload.tool.toLowerCase() : '';
  return tool.includes('todo');
}

function getToolCallId(msg: WsMessage): string | null {
  const payload = msg.payload as { call_id?: unknown };
  return typeof payload.call_id === 'string' && payload.call_id.length > 0 ? payload.call_id : null;
}

/** History rows omitted from transcript list (standalone bubble height 0; would duplicate ScrollView gaps). */
export function isRenderableInChatTranscript(msg: WsMessage): boolean {
  return msg.role !== 'tool_result';
}

function formatWorkedDurationLabel(messages: WsMessage[]): string {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const msg of messages) {
    if (!Number.isFinite(msg.created_at)) continue;
    earliest = Math.min(earliest, msg.created_at);
    latest = Math.max(latest, msg.created_at);
  }

  const rawDurationMilliseconds =
    Number.isFinite(earliest) && Number.isFinite(latest) ? latest - earliest : 0;
  const rawDurationSeconds = rawDurationMilliseconds / 1000;
  const durationSeconds = Math.max(1, Math.round(rawDurationSeconds));
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const duration = minutes > 0 ? `${minutes}m${seconds > 0 ? ` ${seconds}s` : ''}` : `${seconds}s`;

  return `Worked for ${duration}`;
}

function makeWorkedItem(messages: WsMessage[]): ChatTranscriptDisplayItem {
  const firstFoldedSeq = messages[0].seq;
  const lastFoldedSeq = messages[messages.length - 1].seq;
  return {
    kind: 'worked',
    id: `worked-${firstFoldedSeq}-${lastFoldedSeq}`,
    label: formatWorkedDurationLabel(messages),
    messages,
  };
}

function buildCompletedTurnDisplayItems(turn: WsMessage[]): ChatTranscriptDisplayItem[] {
  if (turn.length === 0) return [];

  const userMessage = turn[0];
  if (userMessage.role !== 'user_text') {
    return turn.map((msg) => ({ kind: 'message', message: msg }));
  }

  const askQuestions = turn.filter((msg) => msg.role === 'ask_question');
  const finalAgentMessage = [...turn].reverse().find((msg) => msg.role === 'agent_text');
  const visibleMessages = new Set([userMessage, ...askQuestions]);
  if (finalAgentMessage) visibleMessages.add(finalAgentMessage);

  const hiddenMessages = turn.filter((msg) => !visibleMessages.has(msg));
  const items: ChatTranscriptDisplayItem[] = [{ kind: 'message', message: userMessage }];

  if (hiddenMessages.length > 0) {
    items.push(makeWorkedItem(hiddenMessages));
  }

  for (const askQuestion of askQuestions) {
    items.push({ kind: 'message', message: askQuestion });
  }

  if (finalAgentMessage) {
    items.push({ kind: 'message', message: finalAgentMessage });
  }

  return items;
}

export function buildCompletedTranscriptDisplayItems(
  messages: WsMessage[],
  status: Conversation['status'],
): ChatTranscriptDisplayItem[] {
  const renderableMessages = messages.filter(isRenderableInChatTranscript);

  if (status !== 'completed') {
    return groupAdjacentUserImageMessages(
      renderableMessages.map((msg) => ({ kind: 'message', message: msg })),
    );
  }

  const displayItems: ChatTranscriptDisplayItem[] = [];
  let currentTurn: WsMessage[] = [];

  for (const msg of renderableMessages) {
    if (msg.role === 'user_text') {
      displayItems.push(...buildCompletedTurnDisplayItems(currentTurn));
      currentTurn = [msg];
    } else {
      currentTurn.push(msg);
    }
  }
  displayItems.push(...buildCompletedTurnDisplayItems(currentTurn));

  return groupAdjacentUserImageMessages(displayItems);
}

export function collapseTodoToolCallSnapshots(messages: WsMessage[]): WsMessage[] {
  const latestTodoSeqByCallId = new Map<string, number>();
  for (const msg of messages) {
    if (!isTodoToolCall(msg)) continue;
    const callId = getToolCallId(msg);
    if (!callId) continue;
    latestTodoSeqByCallId.set(callId, msg.seq);
  }
  return messages.filter((msg) => {
    if (!isTodoToolCall(msg)) return true;
    const callId = getToolCallId(msg);
    if (!callId) return true;
    return latestTodoSeqByCallId.get(callId) === msg.seq;
  });
}

export function getLatestAgentTextSeq(messages: WsMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'agent_text') {
      return messages[index].seq;
    }
  }
  return 0;
}

export function getLatestAgentActivitySeq(messages: WsMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user_text' && messages[index].role !== 'system_event') {
      return messages[index].seq;
    }
  }
  return 0;
}

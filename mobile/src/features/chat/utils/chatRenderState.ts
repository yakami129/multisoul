import type { Conversation, WsMessage } from '@/types';

export type ChatTranscriptDisplayItem =
  | { kind: 'message'; message: WsMessage }
  | { kind: 'worked'; id: string; label: string; messages: WsMessage[] };

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

function shouldKeepVisibleInCompletedTranscript(
  msg: WsMessage,
  latestUserSeq: number,
  latestAgentSeq: number,
) {
  if (msg.role === 'user_text') return msg.seq === latestUserSeq;
  if (msg.role === 'agent_text') return msg.seq === latestAgentSeq;
  if (msg.role === 'ask_question') return !msg.answered;
  return false;
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

function keepFinalAnswerAtTail(items: ChatTranscriptDisplayItem[]): ChatTranscriptDisplayItem[] {
  const tail = items.at(-1);
  if (tail?.kind !== 'worked') return items;
  const latestAgentIndex = items.findLastIndex(
    (item) => item.kind === 'message' && item.message.role === 'agent_text',
  );
  if (latestAgentIndex < 0) return items;
  const withoutTail = items.slice(0, -1);
  const beforeAgent = withoutTail.slice(0, latestAgentIndex);
  const latestAgent = withoutTail[latestAgentIndex];
  const afterAgent = withoutTail.slice(latestAgentIndex + 1);
  if (afterAgent.length > 0) return items;
  const previous = beforeAgent.at(-1);
  const nextBeforeAgent =
    previous?.kind === 'worked'
      ? [...beforeAgent.slice(0, -1), makeWorkedItem([...previous.messages, ...tail.messages])]
      : [...beforeAgent, tail];
  return [...nextBeforeAgent, latestAgent, ...afterAgent];
}

export function buildCompletedTranscriptDisplayItems(
  messages: WsMessage[],
  status: Conversation['status'],
): ChatTranscriptDisplayItem[] {
  const renderableMessages = messages.filter(isRenderableInChatTranscript);

  if (status !== 'completed') {
    return renderableMessages.map((msg) => ({ kind: 'message', message: msg }));
  }

  const latestUserSeq =
    [...renderableMessages].reverse().find((msg) => msg.role === 'user_text')?.seq ?? 0;
  const latestAgentSeq =
    [...renderableMessages].reverse().find((msg) => msg.role === 'agent_text')?.seq ?? 0;
  const foldedMessages = renderableMessages.filter(
    (msg) => !shouldKeepVisibleInCompletedTranscript(msg, latestUserSeq, latestAgentSeq),
  );

  if (foldedMessages.length === 0) {
    return renderableMessages.map((msg) => ({ kind: 'message', message: msg }));
  }

  const firstFoldedSeq = foldedMessages[0].seq;
  const lastFoldedSeq = foldedMessages[foldedMessages.length - 1].seq;
  const displayItems: ChatTranscriptDisplayItem[] = [];
  let foldedSegment: WsMessage[] = [];

  function flushFoldedSegment() {
    if (foldedSegment.length === 0) return;
    displayItems.push(makeWorkedItem(foldedSegment));
    foldedSegment = [];
  }

  for (const msg of renderableMessages) {
    if (foldedMessages.includes(msg)) {
      foldedSegment.push(msg);
      continue;
    }
    flushFoldedSegment();
    displayItems.push({ kind: 'message', message: msg });
  }
  flushFoldedSegment();

  return keepFinalAnswerAtTail(displayItems);
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

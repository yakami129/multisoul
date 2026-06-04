import type { WsMessage } from '@/types';

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

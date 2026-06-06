import type { Conversation, WsMessage } from '@/types';

export {
  Conversation,
  WsMessage,
  MessageRole,
  MessagePayload,
  AskQuestionPayload,
  TaskStatusPayload,
  ToolCallPayload,
  ToolResultPayload,
  UserTextPayload,
  AgentTextPayload,
} from '@/types';

// Alias for backward compatibility with AskQuestionCard
export type AskQuestionOption = { id: string; label: string };

export interface TranscriptPage {
  conversation_id: string;
  status: Conversation['status'];
  items: TranscriptItem[];
  page_info: TranscriptPageInfo;
}

export interface TranscriptPageInfo {
  oldest_turn_id: string | null;
  has_older: boolean;
}

export type TranscriptItem = PreludeRawItem | TurnSummaryItem | CurrentTurnRawItem;

export interface PreludeRawItem {
  kind: 'prelude_raw';
  messages: WsMessage[];
}

export interface TurnSummaryItem {
  kind: 'turn_summary';
  turn_id: string;
  start_seq: number;
  end_seq: number;
  user: WsMessage;
  worked?: WorkedSummary | null;
  asks: WsMessage[];
  final_agent?: WsMessage | null;
}

export interface CurrentTurnRawItem {
  kind: 'current_turn_raw';
  turn_id: string;
  start_seq: number;
  messages: WsMessage[];
}

export interface WorkedSummary {
  id: string;
  label: string;
  duration_ms: number;
  hidden_count: number;
  first_hidden_seq: number;
  last_hidden_seq: number;
}

export interface HiddenMessagesResponse {
  conversation_id: string;
  turn_id: string;
  messages: WsMessage[];
}

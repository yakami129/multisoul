// ── Endpoint ──────────────────────────────────────────────────────────────────
export interface Endpoint {
  id: string;
  label: string;
  base_url: string;
  token: string; // stored in AsyncStorage keyed by id, NOT in SQLite
  last_seen_at: number | null;
}

// ── Agent (from CLI serve.db) ─────────────────────────────────────────────────
export interface Agent {
  id: string;
  name: string;
  project_path: string;
  runtime: 'claude-code' | 'codex' | 'cursor-cli' | 'opencode' | 'custom';
  created_at: number;
  // Injected by App after fetch:
  endpoint_id: string;
  endpoint_label: string;
}

export type AgentStatus = 'active' | 'inactive' | 'error';

// ── Conversation ──────────────────────────────────────────────────────────────
export interface Conversation {
  id: string;
  agent_id: string;
  title: string;
  created_at: number;
  last_message_at: number;
  status: 'idle' | 'running' | 'awaiting_question' | 'completed' | 'failed';
  model_id: string | null;
  // Injected:
  endpoint_id: string;
  agent_name: string;
  first_user_message?: string;
  last_ai_reply?: string;
}

export interface RuntimeModel {
  id: string;
  label: string;
  is_default: boolean;
  source: 'builtin' | 'dynamic';
  available: boolean;
}

// ── Messages (§6.2 role schema) ───────────────────────────────────────────────
export type MessageRole =
  | 'user_text'
  | 'agent_text'
  | 'tool_call'
  | 'tool_result'
  | 'ask_question'
  | 'task_status'
  | 'system_event';

export interface WsMessage {
  type: 'message';
  seq: number;
  role: MessageRole;
  payload: MessagePayload;
  created_at: number;
  answered?: boolean;
  answeredChoiceId?: string;
  answeredChoiceIds?: Record<string, string>;
}

export type MessagePayload =
  | UserTextPayload
  | AgentTextPayload
  | ToolCallPayload
  | ToolResultPayload
  | AskQuestionPayload
  | TaskStatusPayload
  | SystemEventPayload;

export interface UserTextPayload {
  text: string;
  file_id?: string;
}
export interface AgentTextPayload {
  text: string;
}
export interface ToolCallPayload {
  tool: string;
  args: string;
  call_id: string;
}
export interface ToolResultPayload {
  call_id: string;
  ok: boolean;
  summary: string;
}
export interface AskQuestionPayload {
  ask_id: string;
  response_mode?: 'user_message';
  questions: Array<{
    id: string;
    text: string;
    options: { id: string; label: string }[];
    multi_select?: boolean;
  }>;
  allow_freeform: boolean;
}
export interface TaskStatusPayload {
  task_id: string;
  status: 'running' | 'completed' | 'failed';
  importance: 'normal' | 'complex';
  summary: string;
}
export interface SystemEventPayload {
  event: 'model_changed';
  from_model_id: string | null;
  to_model_id: string | null;
  from_label: string;
  to_label: string;
}

// ── Inbox (§5.2) ──────────────────────────────────────────────────────────────
export type InboxKind = 'pending_question' | 'complex_done' | 'complex_failed';

export interface InboxItem {
  id: string;
  endpoint_id: string;
  agent_id: string;
  conversation_id: string;
  kind: InboxKind;
  title: string;
  body: string;
  payload: AskQuestionPayload | null;
  received_at: number;
  read_at: number | null;
}

// ── API error ─────────────────────────────────────────────────────────────────
export interface ApiError {
  error: string;
  code: string;
}

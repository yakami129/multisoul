export { Conversation, WsMessage, MessageRole, MessagePayload,
         AskQuestionPayload, TaskStatusPayload, ToolCallPayload,
         ToolResultPayload, UserTextPayload, AgentTextPayload } from '@/types';

// Alias for backward compatibility with AskQuestionCard
export type AskQuestionOption = { id: string; label: string };

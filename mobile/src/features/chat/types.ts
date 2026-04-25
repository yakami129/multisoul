export interface Conversation {
  id: string;
  agentName: string;
  agentInitials: string;
  lastMessage: string;
  timestamp: string;
  hasUnread: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AskQuestionOption {
  id: string;
  label: string;
}

export interface PendingQuestion {
  id: string;
  question: string;
  subtitle?: string;
  options: AskQuestionOption[];
  type: 'single' | 'multi';
  conversationId: string;
}

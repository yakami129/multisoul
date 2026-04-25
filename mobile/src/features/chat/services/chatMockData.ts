import { Conversation, ChatMessage, PendingQuestion } from '../types';

export const mockConversations: Conversation[] = [
  {
    id: 'grok',
    agentName: 'Grok',
    agentInitials: 'G',
    lastMessage: 'How can I help you today?',
    timestamp: '2m ago',
    hasUnread: true,
  },
  {
    id: 'deep-research',
    agentName: 'Deep Research',
    agentInitials: 'DR',
    lastMessage: 'Analyzing market trends...',
    timestamp: '1h ago',
    hasUnread: false,
  },
  {
    id: 'code-assistant',
    agentName: 'Code Assistant',
    agentInitials: 'CA',
    lastMessage: "Here's the optimized function...",
    timestamp: '3h ago',
    hasUnread: false,
  },
  {
    id: 'creative-writing',
    agentName: 'Creative Writing',
    agentInitials: 'CW',
    lastMessage: 'Once upon a time in the wasteland...',
    timestamp: 'Yesterday',
    hasUnread: false,
  },
];

export const mockMessages: Record<string, ChatMessage[]> = {
  grok: [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'VAULT-TEC ASSISTANT ONLINE. How may I assist you today, Overseer?',
      timestamp: '10:00 AM',
    },
    {
      id: 'msg-2',
      role: 'user',
      content: 'Tell me about the Wasteland',
      timestamp: '10:01 AM',
    },
    {
      id: 'msg-3',
      role: 'assistant',
      content:
        'The Wasteland is a post-nuclear landscape spanning the former Commonwealth. Radiation levels vary by zone. Recommend Pip-Boy for navigation and RadAway supplies before venturing out.',
      timestamp: '10:01 AM',
    },
  ],
  'deep-research': [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'DEEP RESEARCH MODULE INITIALIZED. What topic shall I analyze?',
      timestamp: '9:00 AM',
    },
    {
      id: 'msg-2',
      role: 'user',
      content: 'Analyze current market trends',
      timestamp: '9:01 AM',
    },
    {
      id: 'msg-3',
      role: 'assistant',
      content: 'Analyzing market trends...',
      timestamp: '9:01 AM',
    },
  ],
  'code-assistant': [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'CODE ASSISTANT READY. Paste your code or describe the problem.',
      timestamp: '7:00 AM',
    },
    {
      id: 'msg-2',
      role: 'user',
      content: 'Optimize this sorting function',
      timestamp: '7:05 AM',
    },
    {
      id: 'msg-3',
      role: 'assistant',
      content: "Here's the optimized function...",
      timestamp: '7:05 AM',
    },
  ],
  'creative-writing': [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'CREATIVE WRITING MODULE ONLINE. Let us craft a story together.',
      timestamp: 'Yesterday',
    },
    {
      id: 'msg-2',
      role: 'user',
      content: 'Write a story set in the wasteland',
      timestamp: 'Yesterday',
    },
    {
      id: 'msg-3',
      role: 'assistant',
      content: 'Once upon a time in the wasteland...',
      timestamp: 'Yesterday',
    },
  ],
};

export const mockPendingQuestion: PendingQuestion = {
  id: 'q-deploy',
  question: 'Which environment should I deploy to?',
  subtitle: 'Select one option to continue',
  options: [
    { id: 'prod', label: 'Production' },
    { id: 'staging', label: 'Staging' },
    { id: 'dev', label: 'Development' },
  ],
  type: 'single',
  conversationId: 'grok',
};

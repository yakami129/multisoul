import { InboxItem } from '../types';

export const mockInboxItems: InboxItem[] = [
  {
    id: 'inbox-1',
    agentName: 'Deploy Agent',
    agentInitials: 'DA',
    question: 'Which environment should I deploy to?',
    tag: 'Deployment',
    timestamp: '2m ago',
    conversationId: 'grok',
  },
  {
    id: 'inbox-2',
    agentName: 'Code Assistant',
    agentInitials: 'CA',
    question: 'Should I add unit tests for the new auth module?',
    tag: 'Testing',
    timestamp: '15m ago',
    conversationId: 'code-assistant',
  },
  {
    id: 'inbox-3',
    agentName: 'Deep Research',
    agentInitials: 'DR',
    question: 'Do you want me to include competitor analysis?',
    tag: 'Research',
    timestamp: '1h ago',
    conversationId: 'deep-research',
  },
];

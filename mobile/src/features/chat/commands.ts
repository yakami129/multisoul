export type CommandCategory = 'session' | 'help';

export interface ChatCommand {
  id: string;
  label: string;
  command: string;
  description: string;
  category: CommandCategory;
}

export const COMMANDS: ChatCommand[] = [
  {
    id: 'clear',
    label: 'Clear',
    command: '/clear',
    description: '清除当前会话历史',
    category: 'session',
  },
  {
    id: 'reset',
    label: 'Reset',
    command: '/reset',
    description: '重置 Agent 状态',
    category: 'session',
  },
  {
    id: 'new',
    label: 'New',
    command: '/new',
    description: '开启新会话',
    category: 'session',
  },
  {
    id: 'help',
    label: 'Help',
    command: '/help',
    description: '查看帮助',
    category: 'help',
  },
  {
    id: 'status',
    label: 'Status',
    command: '/status',
    description: '查看 Agent 状态',
    category: 'help',
  },
];

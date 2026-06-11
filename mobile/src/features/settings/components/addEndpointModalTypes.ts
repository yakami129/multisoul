export type SetupCommand = {
  id: string;
  title: string;
  command: string;
};

export type Tab = 'qr' | 'manual';
export type ScanStatus = 'idle' | 'checking' | 'invalid_qr' | 'connection_err';
export type ManualStatus = 'idle' | 'checking' | 'connection_err' | 'invalid_paste';

export const SETUP_COMMANDS: SetupCommand[] = [
  { id: 'install', title: '1. Install msctl', command: 'npm install -g @yakami129/msctl' },
  {
    id: 'service',
    title: '2. Start service',
    command: 'msctl daemon quickstart',
  },
  {
    id: 'codex',
    title: 'Codex',
    command: 'cd /path/to/project\nmsctl agent codex',
  },
  {
    id: 'claude',
    title: 'Claude Code',
    command: 'cd /path/to/project\nmsctl agent claude-code',
  },
  {
    id: 'cursor',
    title: 'Cursor Agent CLI',
    command: 'cd /path/to/project\nmsctl agent cursor-cli',
  },
  {
    id: 'opencode',
    title: 'OpenCode',
    command: 'cd /path/to/project\nmsctl agent opencode',
  },
];

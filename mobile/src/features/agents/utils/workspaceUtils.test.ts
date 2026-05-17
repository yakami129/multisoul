import type { Agent } from '@/types';
import { extractWorkspace, getWorkspaceList } from './workspaceUtils';

describe('extractWorkspace', () => {
  it('should extract workspace name from valid path', () => {
    expect(extractWorkspace('/Users/alan/Documents/codes/multisoul')).toBe('multisoul');
    expect(extractWorkspace('/home/user/projects/my-app')).toBe('my-app');
  });

  it('should return null for empty or invalid paths', () => {
    expect(extractWorkspace('')).toBeNull();
    expect(extractWorkspace('   ')).toBeNull();
    expect(extractWorkspace('/')).toBeNull();
  });

  it('should handle paths with trailing slashes', () => {
    expect(extractWorkspace('/Users/alan/codes/multisoul/')).toBe('multisoul');
    expect(extractWorkspace('/home/user/projects/my-app///')).toBe('my-app');
  });

  it('should handle Windows-style paths', () => {
    expect(extractWorkspace('C:\\Users\\alan\\codes\\multisoul')).toBe('multisoul');
  });
});

describe('getWorkspaceList', () => {
  const mockAgents: Agent[] = [
    {
      id: '1',
      name: 'Agent 1',
      project_path: '/Users/alan/codes/multisoul',
      runtime: 'claude-code',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
    {
      id: '2',
      name: 'Agent 2',
      project_path: '/Users/alan/codes/multisoul',
      runtime: 'codex',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
    {
      id: '3',
      name: 'Agent 3',
      project_path: '/Users/alan/codes/project-x',
      runtime: 'claude-code',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
  ];

  it('should generate sorted workspace list', () => {
    const workspaces = getWorkspaceList(mockAgents);
    expect(workspaces).toEqual(['multisoul', 'project-x']);
  });

  it('should deduplicate workspace names', () => {
    const workspaces = getWorkspaceList(mockAgents);
    expect(workspaces.filter((w) => w === 'multisoul')).toHaveLength(1);
  });

  it('should filter out agents with invalid paths', () => {
    const agentsWithInvalid: Agent[] = [
      ...mockAgents,
      {
        id: '4',
        name: 'Invalid Agent',
        project_path: '',
        runtime: 'claude-code',
        created_at: Date.now(),
        endpoint_id: 'ep1',
        endpoint_label: 'MacBook',
      },
    ];
    const workspaces = getWorkspaceList(agentsWithInvalid);
    expect(workspaces).toEqual(['multisoul', 'project-x']);
  });

  it('should return empty array for empty agent list', () => {
    expect(getWorkspaceList([])).toEqual([]);
  });
});

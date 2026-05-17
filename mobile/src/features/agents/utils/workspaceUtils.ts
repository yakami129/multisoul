import type { Agent } from '@/types';

/**
 * 从 project_path 提取工作空间名称
 * @param projectPath - Agent 的 project_path
 * @returns 工作空间名称，如果路径无效则返回 null
 */
export function extractWorkspace(projectPath: string): string | null {
  if (!projectPath || projectPath.trim() === '') {
    return null;
  }

  // 统一处理 Unix 和 Windows 路径分隔符
  const normalizedPath = projectPath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter((s) => s.length > 0);
  return segments[segments.length - 1] || null;
}

/**
 * 从 Agent 列表生成工作空间列表
 * @param agents - Agent 列表
 * @returns 按字母顺序排序的工作空间名称数组
 */
export function getWorkspaceList(agents: Agent[]): string[] {
  const workspaceSet = new Set<string>();

  for (const agent of agents) {
    const workspace = extractWorkspace(agent.project_path);
    if (workspace) {
      workspaceSet.add(workspace);
    }
  }

  return Array.from(workspaceSet).sort();
}

import { type Project, type ProjectResource, type ProjectSession } from '../types';

export type ProjectStatusKind = 'awaiting_question' | 'running' | 'failed' | 'idle' | 'completed';

export type ProjectStatus = {
  kind: ProjectStatusKind;
  pendingCount: number;
  isActive: boolean;
};

const STATUS_RANK: Record<ProjectStatusKind, number> = {
  awaiting_question: 0,
  running: 1,
  failed: 2,
  idle: 3,
  completed: 4,
};

export function projectStatus(project: Project): ProjectStatus {
  const counts = project.session_counts;
  if (counts.awaiting_question > 0) {
    return { kind: 'awaiting_question', pendingCount: counts.awaiting_question, isActive: true };
  }
  if (counts.running > 0) {
    return { kind: 'running', pendingCount: 0, isActive: true };
  }
  if (counts.failed > 0) {
    return { kind: 'failed', pendingCount: 0, isActive: false };
  }
  if (counts.idle > 0) {
    return { kind: 'idle', pendingCount: 0, isActive: false };
  }
  return { kind: 'completed', pendingCount: 0, isActive: false };
}

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const statusDelta =
      STATUS_RANK[projectStatus(left).kind] - STATUS_RANK[projectStatus(right).kind];
    if (statusDelta !== 0) return statusDelta;
    const activityDelta = right.last_activity_at - left.last_activity_at;
    if (activityDelta !== 0) return activityDelta;
    return left.name.localeCompare(right.name);
  });
}

export function totalSessions(project: Project) {
  const counts = project.session_counts;
  return counts.idle + counts.running + counts.awaiting_question + counts.completed + counts.failed;
}

export function relativeAge(ts: number) {
  if (ts <= 0) return 'now';
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatProjectPath(path: string) {
  if (!path) return 'No project path';
  const normalized = path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('~') && parts.length > 3) return `~/${parts.slice(-2).join('/')}`;
  if (parts.length > 3) return `.../${parts.slice(-2).join('/')}`;
  return normalized;
}

export function displayRuntime(runtime: ProjectResource['runtime']) {
  switch (runtime) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor-cli':
      return 'Cursor CLI';
    case 'opencode':
      return 'OpenCode';
    case 'custom':
      return 'Custom';
  }
}

export function resourceNameForSession(
  session: ProjectSession,
  resources: ReadonlyMap<string, ProjectResource>,
) {
  return resources.get(session.agent_id)?.name ?? session.agent_name ?? session.agent_id;
}

export type EndpointFilterOption = {
  id: string;
  label: string;
  count: number;
};

export function getProjectEndpointFilterOptions(projects: Project[]): EndpointFilterOption[] {
  const endpoints = new Map<string, EndpointFilterOption>();
  for (const project of projects) {
    const label = project.endpoint_label.trim() || 'Unnamed machine';
    const current = endpoints.get(project.endpoint_id);
    if (current) current.count += 1;
    else endpoints.set(project.endpoint_id, { id: project.endpoint_id, label, count: 1 });
  }
  return [{ id: 'all', label: 'All Machines', count: projects.length }, ...endpoints.values()];
}

export function endpointName(projects: Project[], fallback: string) {
  const first = projects.find((project) => project.endpoint_label.trim().length > 0);
  return first?.endpoint_label ?? fallback;
}

import { type Agent, type Conversation } from '@/types';

export type ProjectStatusLabel =
  | 'agents.statusAwaiting'
  | 'agents.statusRunning'
  | 'agents.statusFailed'
  | 'agents.statusIdle';

export type ProjectStatus = {
  label: ProjectStatusLabel;
  kind: 'idle' | 'running' | 'awaiting_question' | 'failed';
  isActive: boolean;
  pendingCount: number;
};

export type ProjectItem = {
  agent: Agent;
  status: ProjectStatus;
};

const PROJECT_STATUS_RANK: Record<ProjectStatus['kind'], number> = {
  awaiting_question: 0,
  running: 1,
  failed: 2,
  idle: 3,
};

export function projectStatus(conversations: Conversation[]): ProjectStatus {
  const pendingCount = conversations.filter((conv) => conv.status === 'awaiting_question').length;
  if (pendingCount > 0) {
    return {
      label: 'agents.statusAwaiting',
      kind: 'awaiting_question',
      isActive: true,
      pendingCount,
    };
  }
  if (conversations.some((conv) => conv.status === 'running')) {
    return { label: 'agents.statusRunning', kind: 'running', isActive: true, pendingCount: 0 };
  }
  // Only show Failed if the most recent conversation is failed; historical failures don't
  // affect fleet status once newer conversations exist.
  const mostRecent = [...conversations].sort((a, b) => b.last_message_at - a.last_message_at)[0];
  if (mostRecent?.status === 'failed') {
    return { label: 'agents.statusFailed', kind: 'failed', isActive: false, pendingCount: 0 };
  }
  return { label: 'agents.statusIdle', kind: 'idle', isActive: false, pendingCount: 0 };
}

export function sortProjectsByStatus(projects: ProjectItem[]): ProjectItem[] {
  return [...projects].sort(
    (left, right) => PROJECT_STATUS_RANK[left.status.kind] - PROJECT_STATUS_RANK[right.status.kind],
  );
}

export function endpointName(agents: Agent[], fallback: string) {
  const first = agents.find((agent) => agent.endpoint_label.trim().length > 0);
  return first?.endpoint_label ?? fallback;
}

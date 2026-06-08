import { brandColors } from '@/theme/brandRefresh';

export interface ActivityItem {
  id: string;
  section: 'attention' | 'running' | 'done';
  projectName: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: 'attention' | 'running' | 'done' | 'failed';
  timestamp: number;
  endpointId: string;
  endpointLabel: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  workflowId?: string;
  workflowRunId?: string;
  workflowName?: string;
  readAt?: number | null;
  askId?: string;
}

export type ActivityFilter = 'all' | 'pending' | 'running' | 'done';
export type DoneFilter = 'unread' | 'read';

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

export function byNewest(a: ActivityItem, b: ActivityItem): number {
  return b.timestamp - a.timestamp;
}

export function tagStyle(item: ActivityItem): { bg: string; color: string } {
  if (item.section === 'running')
    return { bg: brandColors.activityTagBlueBg, color: brandColors.activityTagBlueText };
  if (item.tone === 'failed')
    return { bg: brandColors.activityTagOrangeBg, color: brandColors.activityTagOrangeText };
  if (item.section === 'done')
    return { bg: brandColors.activityTagGreenBg, color: brandColors.activityTagGreenText };
  return { bg: brandColors.activityTagOrangeBg, color: brandColors.activityTagOrangeText };
}

export const ACTIVITY_FILTERS: Array<{ key: ActivityFilter; label: string; dot?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending', dot: brandColors.activityOrange },
  { key: 'running', label: 'Running', dot: brandColors.activityCyan },
  { key: 'done', label: 'Done', dot: brandColors.activityLime },
];

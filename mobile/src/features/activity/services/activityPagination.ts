import { type AggregatedActivityItem, type AggregatedActivityResult } from './activityService';

export const ACTIVITY_PAGE_SIZE = 20;

export function nextActivityLimit(currentLimit: number, pageSize = ACTIVITY_PAGE_SIZE): number {
  return currentLimit + pageSize;
}

export function activityResultCount(result: AggregatedActivityResult): number {
  return result.needsAttention.length + result.running.length + result.done.length;
}

function dedupeById(items: AggregatedActivityItem[]): AggregatedActivityItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function mergeActivityPages(pages: AggregatedActivityResult[]): AggregatedActivityResult {
  const latest = pages.at(-1);
  if (!latest) {
    return {
      needsAttention: [],
      running: [],
      done: [],
      failedEndpoints: [],
    };
  }

  return {
    needsAttention: dedupeById(latest.needsAttention),
    running: dedupeById(latest.running),
    done: dedupeById(latest.done),
    failedEndpoints: [...latest.failedEndpoints],
  };
}

export function hasMoreActivity({
  previousCount,
  currentCount,
  currentLimit,
}: {
  previousCount: number;
  currentCount: number;
  currentLimit: number;
}): boolean {
  return currentLimit > 0 && currentCount > previousCount;
}

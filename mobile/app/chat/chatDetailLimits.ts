import { type WsMessage } from '@/types';

export const INITIAL_MESSAGE_LIMIT = 15;
export const OLDER_MESSAGE_LIMIT = 50;
export const FOCUS_MESSAGE_LIMIT = 100;
export const TOP_LOAD_THRESHOLD = 80;
export const BOTTOM_STICKY_THRESHOLD = 120;

export function getLatestWindowMinSeq(messages: WsMessage[], limit: number): number | null {
  if (messages.length === 0) return null;
  return messages[Math.max(messages.length - limit, 0)]?.seq ?? null;
}

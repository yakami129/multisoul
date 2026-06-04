import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type WsMessage } from '@/types';

export const EMPTY_MESSAGES: WsMessage[] = [];

export const WAITING_MESSAGE: WsMessage = {
  type: 'message',
  seq: -1,
  role: 'agent_text',
  payload: { text: '' },
  created_at: 0,
};

export const STATUS_BADGE: Record<string, { label: string; bg: string; dot: string }> = {
  running: { label: 'RUNNING', bg: brandRgba.white88, dot: brandColors.cyan },
  awaiting_question: { label: 'AWAITING', bg: brandRgba.white88, dot: brandColors.coral },
  completed: { label: 'COMPLETED', bg: brandRgba.white88, dot: brandColors.lime },
  failed: { label: 'FAILED', bg: brandRgba.white88, dot: brandColors.error },
  idle: { label: 'IDLE', bg: brandRgba.white88, dot: brandColors.textMuted },
};

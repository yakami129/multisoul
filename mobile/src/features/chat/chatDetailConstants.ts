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

export const STATUS_BADGE: Record<string, { label: string; bg: string; dot: string; fg: string }> =
  {
    running: {
      label: 'Running',
      bg: brandRgba.limeSoft,
      dot: brandColors.successCompat,
      fg: brandColors.successCompat,
    },
    awaiting_question: {
      label: 'Awaiting',
      bg: brandRgba.coralSoft,
      dot: brandColors.coral,
      fg: brandColors.coral,
    },
    completed: {
      label: 'Completed',
      bg: brandRgba.limeSoft,
      dot: brandColors.successCompat,
      fg: brandColors.successCompat,
    },
    failed: {
      label: 'Failed',
      bg: brandRgba.white88,
      dot: brandColors.error,
      fg: brandColors.error,
    },
    idle: {
      label: 'Idle',
      bg: brandRgba.white88,
      dot: brandColors.textMuted,
      fg: brandColors.ink,
    },
  };

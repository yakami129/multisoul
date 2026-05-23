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
  running: { label: 'RUNNING', bg: '#1A1A1A', dot: '#FF6B35' },
  awaiting_question: { label: 'AWAITING', bg: '#1A1A1A', dot: '#FF6B35' },
  completed: { label: 'COMPLETED', bg: '#1A1A1A', dot: '#4CAF50' },
  failed: { label: 'FAILED', bg: '#1A1A1A', dot: '#FF4444' },
  idle: { label: 'IDLE', bg: '#1A1A1A', dot: '#555555' },
};

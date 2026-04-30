import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchMessages } from '@/features/chat/services/chatService';
import { markAskAnswered } from '@/features/inbox/services/inboxService';
import { buildAskQuestionInboxItem } from '@/features/inbox/utils/buildAskQuestionInboxItem';
import { notifyTaskComplete } from '@/services/notificationService';
import { useChatStore } from '@/store/chatStore';
import { useInboxStore } from '@/store/inboxStore';
import { type WsMessage, type AskQuestionPayload, type TaskStatusPayload } from '@/types';

type WsStatus = 'connecting' | 'open' | 'closed';

interface UseWebSocketOptions {
  base_url: string;
  token: string;
  conv_id: string;
  endpoint_id: string;
  agent_id: string;
  agent_name?: string;
}

interface UseWebSocketReturn {
  status: WsStatus;
  sendAnswer: (ask_id: string, choice_id?: string, freeform?: string) => void;
  sendAnswerMulti: (ask_id: string, choice_ids: Record<string, string>) => void;
}

const MAX_BACKOFF_MS = 30_000;

export function useWebSocket({
  base_url,
  token,
  conv_id,
  endpoint_id,
  agent_id,
  agent_name,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const addInboxItem = useInboxStore((s) => s.addItem);
  const removeInboxItem = useInboxStore((s) => s.removeItem);

  const appendMessageRef = useRef(appendMessage);
  useEffect(() => {
    appendMessageRef.current = appendMessage;
  }, [appendMessage]);

  const setMessagesRef = useRef(setMessages);
  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  const addInboxItemRef = useRef(addInboxItem);
  useEffect(() => {
    addInboxItemRef.current = addInboxItem;
  }, [addInboxItem]);

  // Track the highest seq we've seen so we can catch up on reconnect
  const lastSeqRef = useRef(0);

  const connect = useCallback(() => {
    if (!base_url) return;
    const wsUrl = base_url.replace(/^https/, 'wss').replace(/^http/, 'ws');
    const url = `${wsUrl}/ws/conversations/${conv_id}?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      setStatus('open');
      backoffRef.current = 1000;

      // Catch up on any messages broadcast while we were disconnected
      fetchMessages(base_url, token, conv_id, lastSeqRef.current)
        .then((msgs) => {
          if (msgs.length > 0) {
            msgs.forEach((m) => {
              appendMessageRef.current(conv_id, m);
              if (m.seq > lastSeqRef.current) lastSeqRef.current = m.seq;
            });
          }
        })
        .catch(() => {});

      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30_000);

      ws.onclose = () => {
        clearInterval(hb);
        setStatus('closed');
        setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      };
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data as string) as {
          type?: string;
          [key: string]: unknown;
        };
        if (envelope.type === 'message') {
          const msg = envelope as unknown as WsMessage;
          appendMessageRef.current(conv_id, msg);
          if (msg.seq > lastSeqRef.current) lastSeqRef.current = msg.seq;

          // When agent asks a question, mirror it to the inbox so the user
          // can answer even if they navigate away from the chat screen.
          if (msg.role === 'ask_question' && msg.payload) {
            const p = msg.payload as AskQuestionPayload;
            const item = buildAskQuestionInboxItem({
              askPayload: p,
              endpoint_id,
              agent_id,
              agent_name,
              conversation_id: conv_id,
            });
            void addInboxItemRef.current(item);
          }

          // Notify user when a task completes
          if (msg.role === 'task_status' && msg.payload) {
            const p = msg.payload as TaskStatusPayload;
            if (p.status === 'completed') {
              void notifyTaskComplete({
                agentName: agent_name ?? agent_id,
                summary: p.summary,
                agentId: agent_id,
                convId: conv_id,
                endpointId: endpoint_id,
              });
            }
          }
        }
      } catch {
        /* ignore malformed */
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [base_url, token, conv_id, endpoint_id, agent_id, agent_name]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const markAnswered = useChatStore((s) => s.markAnswered);

  const markAnsweredRef = useRef(markAnswered);
  useEffect(() => {
    markAnsweredRef.current = markAnswered;
  }, [markAnswered]);

  const sendAnswer = useCallback(
    (ask_id: string, choice_id?: string, freeform?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_id, freeform }));
        void removeInboxItem(ask_id);
        void markAskAnswered(ask_id, conv_id, choice_id);
        markAnsweredRef.current(conv_id, ask_id, choice_id);
      }
    },
    [removeInboxItem, conv_id],
  );

  const sendAnswerMulti = useCallback(
    (ask_id: string, choice_ids: Record<string, string>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_ids }));
        void removeInboxItem(ask_id);
        void markAskAnswered(ask_id, conv_id, undefined, choice_ids);
        markAnsweredRef.current(conv_id, ask_id, undefined, choice_ids);
      }
    },
    [removeInboxItem, conv_id],
  );

  return { status, sendAnswer, sendAnswerMulti };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  fetchMessages,
  parseAnswerAcknowledgement,
  type AnswerAcknowledgement,
} from '@/features/chat/services/chatService';
import { markAskAnswered, loadAnsweredAsks } from '@/features/inbox/services/inboxService';
import { buildAskQuestionInboxItem } from '@/features/inbox/utils/buildAskQuestionInboxItem';
import { mirrorAskQuestionsToInbox } from '@/features/inbox/utils/mirrorAskQuestionsToInbox';
import { TelemetryService } from '@/services/telemetry';
import { useChatStore } from '@/store/chatStore';
import { useInboxStore } from '@/store/inboxStore';
import {
  type WsMessage,
  type AskQuestionPayload,
  type TaskStatusPayload,
  type Conversation,
} from '@/types';

type WsStatus = 'connecting' | 'open' | 'closed';

interface PendingAnswer {
  choice_id?: string;
  choice_ids?: Record<string, string>;
  freeform?: string;
}

interface UseWebSocketOptions {
  base_url: string;
  token: string;
  conv_id: string;
  endpoint_id: string;
  agent_id: string;
  agent_name?: string;
  enableCatchUp?: boolean;
  catchUpAfterSeq?: number;
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
  enableCatchUp = true,
  catchUpAfterSeq,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const markAnswered = useChatStore((s) => s.markAnswered);
  const addInboxItem = useInboxStore((s) => s.addItem);
  const removeAnsweredAsk = useInboxStore((s) => s.removeAnsweredAsk);
  const pendingAnswersRef = useRef<Map<string, PendingAnswer>>(new Map());

  const appendMessageRef = useRef(appendMessage);
  useEffect(() => {
    appendMessageRef.current = appendMessage;
  }, [appendMessage]);

  const setMessagesRef = useRef(setMessages);
  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  const updateConversationRef = useRef(updateConversation);
  useEffect(() => {
    updateConversationRef.current = updateConversation;
  }, [updateConversation]);

  const markAnsweredRef = useRef(markAnswered);
  useEffect(() => {
    markAnsweredRef.current = markAnswered;
  }, [markAnswered]);

  const addInboxItemRef = useRef(addInboxItem);
  useEffect(() => {
    addInboxItemRef.current = addInboxItem;
  }, [addInboxItem]);

  const removeAnsweredAskRef = useRef(removeAnsweredAsk);
  useEffect(() => {
    removeAnsweredAskRef.current = removeAnsweredAsk;
  }, [removeAnsweredAsk]);

  const enableCatchUpRef = useRef(enableCatchUp);
  useEffect(() => {
    enableCatchUpRef.current = enableCatchUp;
  }, [enableCatchUp]);

  const handleAnswerAcknowledgement = useCallback(
    (ack: AnswerAcknowledgement) => {
      const pending = pendingAnswersRef.current.get(ack.ask_id);
      if (!pending && !ack.choice_id && !ack.choice_ids && !ack.freeform) return;

      pendingAnswersRef.current.delete(ack.ask_id);
      if (!ack.ok) {
        updateConversationRef.current(conv_id, { status: 'awaiting_question' });
        return;
      }

      const choice_id = ack.choice_id ?? pending?.choice_id;
      const choice_ids = ack.choice_ids ?? pending?.choice_ids;
      updateConversationRef.current(conv_id, { status: 'running' });
      void removeAnsweredAskRef.current(ack.ask_id);
      void markAskAnswered(ack.ask_id, conv_id, choice_id, choice_ids);
      markAnsweredRef.current(conv_id, ack.ask_id, choice_id, choice_ids);
    },
    [conv_id],
  );

  // Track the highest seq we've seen so we can catch up on reconnect
  const lastSeqRef = useRef(0);
  const convIdRef = useRef(conv_id);
  const inFlightCatchUpRef = useRef<{ sinceSeq: number } | null>(null);
  // Tracks whether the current connect() invocation is still the active one.
  // Set to false in the useEffect cleanup so a stale socket's onclose won't
  // trigger a reconnect after the effect has been torn down.
  const isCurrentRef = useRef(true);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (convIdRef.current !== conv_id) {
      convIdRef.current = conv_id;
      lastSeqRef.current = catchUpAfterSeq ?? 0;
      inFlightCatchUpRef.current = null;
      return;
    }
    if (catchUpAfterSeq != null && catchUpAfterSeq > lastSeqRef.current) {
      lastSeqRef.current = catchUpAfterSeq;
    }
  }, [conv_id, catchUpAfterSeq]);

  const runCatchUp = useCallback(() => {
    const sinceSeq = lastSeqRef.current;
    if (inFlightCatchUpRef.current?.sinceSeq === sinceSeq) return;
    const request = { sinceSeq };
    inFlightCatchUpRef.current = request;
    fetchMessages(base_url, token, conv_id, sinceSeq)
      .then(async (msgs) => {
        if (msgs.length > 0) {
          msgs.forEach((m) => {
            appendMessageRef.current(conv_id, m);
            if (m.seq > lastSeqRef.current) lastSeqRef.current = m.seq;
          });
          const answeredMap = await loadAnsweredAsks(conv_id);
          const merged = msgs.map((m) => {
            if (m.role !== 'ask_question') return m;
            const ask_id = (m.payload as AskQuestionPayload | null)?.ask_id ?? '';
            return answeredMap.has(ask_id) ? { ...m, answered: true } : m;
          });
          void mirrorAskQuestionsToInbox({
            messages: merged,
            endpoint_id,
            agent_id,
            agent_name,
            conversation_id: conv_id,
            addItem: addInboxItemRef.current,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (inFlightCatchUpRef.current === request) {
          inFlightCatchUpRef.current = null;
        }
      });
  }, [base_url, token, conv_id, endpoint_id, agent_id, agent_name]);

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

      // Catch up on any messages broadcast while we were disconnected.
      if (enableCatchUpRef.current) runCatchUp();

      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30_000);

      ws.onclose = () => {
        clearInterval(hb);
        inFlightCatchUpRef.current = null;
        setStatus('closed');
        // Only reconnect if this effect instance is still active.
        // If the effect was cleaned up (conv_id changed, component unmounted),
        // isCurrentRef.current is false and we skip reconnect to avoid a
        // duplicate connection that would receive messages twice.
        if (isCurrentRef.current) {
          setTimeout(connect, backoffRef.current);
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        }
      };
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data as string) as {
          type?: string;
          [key: string]: unknown;
        };
        const answerAck = parseAnswerAcknowledgement(envelope);
        if (answerAck) {
          handleAnswerAcknowledgement(answerAck);
          return;
        }
        if (envelope.type === 'message') {
          const msg = envelope as unknown as WsMessage;
          appendMessageRef.current(conv_id, msg);
          if (msg.seq > lastSeqRef.current) lastSeqRef.current = msg.seq;

          // When agent asks a question, mirror it to the inbox so the user
          // can answer even if they navigate away from the chat screen.
          if (msg.role === 'ask_question' && msg.payload) {
            updateConversationRef.current(conv_id, {
              status: 'awaiting_question',
              last_message_at: msg.created_at,
            });
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

          if (msg.role === 'task_status' && msg.payload) {
            const p = msg.payload as TaskStatusPayload;
            updateConversationRef.current(conv_id, {
              status: p.status as Conversation['status'],
              last_message_at: msg.created_at,
            });
          }
        }
      } catch {
        /* ignore malformed */
      }
    };

    ws.onerror = () => {
      try {
        TelemetryService.getInstance().track({
          event_type: 'ws_error',
          level: 'error',
          data: {
            reason: 'connection_error',
            endpoint: url,
            retry_count: retryCountRef.current,
          },
        });
      } catch {
        // Never break WS logic
      }
      retryCountRef.current += 1;
      ws.close();
    };
  }, [
    base_url,
    token,
    conv_id,
    endpoint_id,
    agent_id,
    agent_name,
    runCatchUp,
    handleAnswerAcknowledgement,
  ]);

  useEffect(() => {
    if (!enableCatchUp || wsRef.current?.readyState !== WebSocket.OPEN) return;
    runCatchUp();
  }, [enableCatchUp, catchUpAfterSeq, runCatchUp]);

  useEffect(() => {
    isCurrentRef.current = true;
    connect();
    return () => {
      // Mark this effect instance as stale so the socket's onclose won't
      // trigger a reconnect after cleanup (prevents duplicate connections).
      isCurrentRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  const sendAnswer = useCallback((ask_id: string, choice_id?: string, freeform?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      pendingAnswersRef.current.set(ask_id, { choice_id, freeform });
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_id, freeform }));
    }
  }, []);

  const sendAnswerMulti = useCallback((ask_id: string, choice_ids: Record<string, string>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      pendingAnswersRef.current.set(ask_id, { choice_ids });
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_ids }));
    }
  }, []);

  return { status, sendAnswer, sendAnswerMulti };
}

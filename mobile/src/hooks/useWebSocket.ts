import { useEffect, useRef, useState, useCallback } from 'react';
import { WsMessage } from '@/types';
import { useChatStore } from '@/store/chatStore';

type WsStatus = 'connecting' | 'open' | 'closed';

interface UseWebSocketOptions {
  base_url: string;
  token: string;
  conv_id: string;
}

interface UseWebSocketReturn {
  status: WsStatus;
  sendAnswer: (ask_id: string, choice_id?: string, freeform?: string) => void;
}

const MAX_BACKOFF_MS = 30_000;

export function useWebSocket({ base_url, token, conv_id }: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const appendMessage = useChatStore((s) => s.appendMessage);

  // Bug 2 fix: appendMessage is a new reference every render; hold it in a ref so it
  // never enters the useCallback dependency array and doesn't trigger infinite reconnects.
  const appendMessageRef = useRef(appendMessage);
  useEffect(() => { appendMessageRef.current = appendMessage; }, [appendMessage]);

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
        const envelope = JSON.parse(event.data as string);
        if (envelope.type === 'message') {
          appendMessageRef.current(conv_id, envelope as WsMessage);
        }
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [base_url, token, conv_id]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendAnswer = useCallback((ask_id: string, choice_id?: string, freeform?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_id, freeform }));
    }
  }, []);

  return { status, sendAnswer };
}

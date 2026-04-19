import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  streaming?: boolean;
}

export type ChatStatus = 'connecting' | 'connected' | 'reconnecting';

interface Options {
  agentId: string;
  serverUrl: string;
  apiKey: string;
}

const MAX_RECONNECT_DELAY = 30_000;

export function useChatSocket({ agentId, serverUrl, apiKey }: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1_000);
  const unmounted = useRef(false);

  const handleMessage = useCallback((envelope: { type: string; payload: any }) => {
    if (envelope.type === 'history') {
      const msgs: ChatMessage[] = (envelope.payload.messages ?? []).map((m: any) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.created_at,
      }));
      setMessages(msgs);
    } else if (envelope.type === 'chunk') {
      const { message_id, text, done } = envelope.payload;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === message_id);
        if (idx === -1) {
          return [...prev, {
            id: message_id, role: 'assistant',
            text, createdAt: new Date().toISOString(),
            streaming: !done,
          }];
        }
        // Replace in-place (server sends full accumulated text each chunk)
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text, streaming: !done };
        return updated;
      });
    }
  }, []);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    const base = serverUrl.replace(/^http/, 'ws');
    const wsUrl = `${base}/ws/chat?token=${apiKey}&agent_id=${agentId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      reconnectDelay.current = 1_000;
      setStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data as string);
        handleMessage(envelope);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setStatus('reconnecting');
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
      setTimeout(connect, delay);
    };
  }, [agentId, serverUrl, apiKey, handleMessage]);

  const send = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'message',
      payload: { agent_id: agentId, text },
    }));
    // Optimistically add user message
    setMessages((prev) => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    }]);
  }, [agentId]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  return { messages, status, send };
}

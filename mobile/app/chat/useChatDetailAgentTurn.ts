import { useEffect, useState, type RefObject } from 'react';
import { type FlatList } from 'react-native';
import { abortConversation, postMessage } from '@/features/chat/services/chatService';
import {
  type ChatTranscriptDisplayItem,
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
} from '@/features/chat/utils/chatRenderState';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import { useChatStore } from '@/store/chatStore';
import { type Endpoint, type WsMessage } from '@/types';
import { type PendingImage } from './usePendingImageUploads';

type AgentTurnParams = {
  conv_id: string;
  endpoint: Endpoint | undefined;
  endpoint_id: string | undefined;
  messages: WsMessage[];
  conversationStatus: string;
  conversation: { status?: string } | undefined;
  hasLoadedInitialMessagesRef: React.MutableRefObject<boolean>;
  lastSeenAgentActivitySeqRef: React.MutableRefObject<number>;
  lastAnimatedAgentTextSeqRef: React.MutableRefObject<number>;
  pendingImages: PendingImage[];
  clearPendingImages: () => void;
  listRef: RefObject<FlatList<ChatTranscriptDisplayItem> | null>;
};

export function useChatDetailAgentTurn({
  conv_id,
  endpoint,
  endpoint_id,
  messages,
  conversationStatus,
  conversation,
  hasLoadedInitialMessagesRef,
  lastSeenAgentActivitySeqRef,
  lastAnimatedAgentTextSeqRef,
  pendingImages,
  clearPendingImages,
  listRef,
}: AgentTurnParams) {
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [typewriterSeq, setTypewriterSeq] = useState<number | null>(null);
  const updateConversation = useChatStore((s) => s.updateConversation);

  const latestAgentActivitySeq = getLatestAgentActivitySeq(messages);
  const latestAgentSeq = getLatestAgentTextSeq(messages);

  const incomingAgentActivitySeq =
    isAwaitingResponse && latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current
      ? latestAgentActivitySeq
      : null;
  const incomingAgentTextSeq =
    hasLoadedInitialMessagesRef.current && latestAgentSeq > lastAnimatedAgentTextSeqRef.current
      ? latestAgentSeq
      : null;
  const activeTypewriterSeq = incomingAgentTextSeq ?? typewriterSeq;

  const lastMsg = messages.at(-1);
  const shouldForceComplete =
    lastMsg?.role === 'tool_call' ||
    conversationStatus === 'completed' ||
    conversationStatus === 'failed';
  const isAgentRunning = isAwaitingResponse || conversationStatus === 'running';

  useEffect(() => {
    if (isAwaitingResponse && latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current) {
      setIsAwaitingResponse(false);
      lastSeenAgentActivitySeqRef.current = latestAgentActivitySeq;
    } else if (
      !isAwaitingResponse &&
      latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current
    ) {
      lastSeenAgentActivitySeqRef.current = latestAgentActivitySeq;
    }

    if (latestAgentSeq > lastAnimatedAgentTextSeqRef.current) {
      if (hasLoadedInitialMessagesRef.current) {
        setTypewriterSeq(latestAgentSeq);
      }
      lastAnimatedAgentTextSeqRef.current = latestAgentSeq;
    }
  }, [
    isAwaitingResponse,
    latestAgentActivitySeq,
    latestAgentSeq,
    hasLoadedInitialMessagesRef,
    lastSeenAgentActivitySeqRef,
    lastAnimatedAgentTextSeqRef,
  ]);

  useEffect(() => {
    if (isAwaitingResponse && conversation && conversationStatus !== 'running') {
      setIsAwaitingResponse(false);
    }
  }, [conversationStatus, isAwaitingResponse, conversation]);

  async function handleSend(input: string) {
    const text = input.trim();
    const uploadedImages = pendingImages.filter((img) => img.status === 'uploaded' && img.fileId);
    if ((!text && uploadedImages.length === 0) || !endpoint) return;

    lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(messages);
    lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(messages);
    hasLoadedInitialMessagesRef.current = true;
    updateConversation(conv_id, { status: 'running' });
    clearPendingImages();
    setIsAwaitingResponse(true);
    setTypewriterSeq(null);

    try {
      if (uploadedImages.length > 0) {
        for (let i = 0; i < uploadedImages.length; i++) {
          const img = uploadedImages[i];
          const msgText = i === uploadedImages.length - 1 ? text : '';
          await postMessage(endpoint.base_url, endpoint.token, conv_id, msgText, img.fileId!);
        }
      } else {
        await postMessage(endpoint.base_url, endpoint.token, conv_id, text);
      }
    } catch (error: unknown) {
      recordDiagnosticsEvent('error', 'chat.send', 'failed to send message', {
        conv_id,
        endpoint_id,
        image_count: uploadedImages.length,
        error,
      });
      setIsAwaitingResponse(false);
    }
  }

  function handleStop() {
    if (!endpoint) {
      recordDiagnosticsEvent('warn', 'chat.abort', 'abort skipped without endpoint', {
        conv_id,
        endpoint_id,
      });
      console.warn('abort: no endpoint available');
      return;
    }
    void abortConversation(endpoint.base_url, endpoint.token, conv_id)
      .then(() => {
        setIsAwaitingResponse(false);
        updateConversation(conv_id, { status: 'idle' });
      })
      .catch((e: unknown) => {
        recordDiagnosticsEvent('warn', 'chat.abort', 'abort request failed', {
          conv_id,
          endpoint_id,
          error: e,
        });
        console.warn('abort failed', e);
      });
  }

  return {
    isAwaitingResponse,
    incomingAgentActivitySeq,
    activeTypewriterSeq,
    shouldForceComplete,
    isAgentRunning,
    handleSend,
    handleStop,
  };
}

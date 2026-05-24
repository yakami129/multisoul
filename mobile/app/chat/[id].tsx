import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EMPTY_MESSAGES, STATUS_BADGE } from '@/features/chat/chatDetailConstants';
import ChatInputBar from '@/features/chat/components/ChatInputBar';
import CommandPopup from '@/features/chat/components/CommandPopup';
import {
  postMessage,
  fetchMessages,
  abortConversation,
  resolveUserMessageImageUri,
} from '@/features/chat/services/chatService';
import {
  getAskId,
  getMaxMessageSeq,
  hasAskId,
  hydrateAnswered,
  shouldMergeInitialHistory,
} from '@/features/chat/utils/chatMessageWindows';
import {
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
  isRenderableInChatTranscript,
} from '@/features/chat/utils/chatRenderState';
import { loadAnsweredAsks } from '@/features/inbox/services/inboxService';
import { mirrorAskQuestionsToInbox } from '@/features/inbox/utils/mirrorAskQuestionsToInbox';
import { useWebSocket } from '@/hooks/useWebSocket';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { useInboxStore } from '@/store/inboxStore';
import { type WsMessage } from '@/types';
import ChatHeader from './ChatHeader';
import ChatTranscriptList from './ChatTranscriptList';
import { s } from './styles';
import { usePendingImageUploads } from './usePendingImageUploads';

const INITIAL_MESSAGE_LIMIT = 15,
  OLDER_MESSAGE_LIMIT = 50,
  FOCUS_MESSAGE_LIMIT = 100;
const TOP_LOAD_THRESHOLD = 80,
  BOTTOM_STICKY_THRESHOLD = 120;

export default function ChatDetailScreen() {
  const {
    id: conv_id,
    endpoint_id,
    agent_id,
    agent_name,
    focus_ask_id,
  } = useLocalSearchParams<{
    id: string;
    endpoint_id: string;
    agent_id?: string;
    agent_name?: string;
    focus_ask_id?: string;
  }>();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [typewriterSeq, setTypewriterSeq] = useState<number | null>(null);
  const [commandPopupVisible, setCommandPopupVisible] = useState(false);
  const imageMapRef = useRef<Map<string, string>>(new Map());
  const listRef = useRef<FlatList<WsMessage>>(null);
  const prevMessageCountRef = useRef(0);
  const didScrollToFocusRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  const hasOlderMessagesRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const lastOlderRequestBeforeSeqRef = useRef<number | null>(null),
    historyRequestGenerationRef = useRef(0),
    olderLoadRequestIdRef = useRef(0);

  const endpoint = useEndpointStore((s) => s.endpoints.find((e) => e.id === endpoint_id));
  const conversations = useChatStore((s) => s.conversations);
  const messagesMap = useChatStore((s) => s.messages);
  const messages = messagesMap[conv_id] ?? EMPTY_MESSAGES;
  const [catchUpAfterSeq, setCatchUpAfterSeq] = useState<number | null>(() =>
    messages.length > 0 ? getMaxMessageSeq(messages) : null,
  );
  const transcriptMessages = React.useMemo(
    () => messages.filter(isRenderableInChatTranscript),
    [messages],
  );
  const resetMessages = useChatStore((s) => s.resetMessages);
  const mergeMessages = useChatStore((s) => s.mergeMessages);
  const prependMessages = useChatStore((s) => s.prependMessages);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const addInboxItem = useInboxStore((s) => s.addItem);
  const conversation = conversations.find((c) => c.id === conv_id);
  const { pendingImages, pickImage, removePendingImage, clearPendingImages } =
    usePendingImageUploads({ endpoint, endpoint_id, imageMapRef });
  const inboxMirrorStableKey = `${conversation?.agent_id ?? agent_id ?? ''}:${conversation?.agent_name ?? agent_name ?? ''}`;
  const navTitle = conversation?.agent_name ?? agent_name ?? conversation?.title ?? 'CHAT';
  const latestAgentActivitySeq = getLatestAgentActivitySeq(messages);
  const latestAgentSeq = getLatestAgentTextSeq(messages);
  const lastSeenAgentActivitySeqRef = useRef(latestAgentActivitySeq);
  const lastAnimatedAgentTextSeqRef = useRef(latestAgentSeq);
  const hasLoadedInitialMessagesRef = useRef(messages.length > 0);
  const incomingAgentActivitySeq =
    isAwaitingResponse && latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current
      ? latestAgentActivitySeq
      : null;
  const incomingAgentTextSeq =
    hasLoadedInitialMessagesRef.current && latestAgentSeq > lastAnimatedAgentTextSeqRef.current
      ? latestAgentSeq
      : null;
  const activeTypewriterSeq = incomingAgentTextSeq ?? typewriterSeq;
  const imageUriForMessage = React.useCallback(
    (msg: WsMessage) => {
      if (!endpoint) return undefined;
      return resolveUserMessageImageUri(
        msg,
        endpoint.base_url,
        endpoint.token,
        imageMapRef.current,
      );
    },
    [endpoint],
  );

  const { status, sendAnswer, sendAnswerMulti } = useWebSocket(
    endpoint
      ? {
          base_url: endpoint.base_url,
          token: endpoint.token,
          conv_id,
          endpoint_id: endpoint_id ?? '',
          agent_id: conversation?.agent_id ?? agent_id ?? '',
          agent_name: conversation?.agent_name ?? agent_name ?? '',
          enableCatchUp: catchUpAfterSeq != null,
          catchUpAfterSeq: catchUpAfterSeq ?? undefined,
        }
      : {
          base_url: '',
          token: '',
          conv_id,
          endpoint_id: '',
          agent_id: '',
          agent_name: '',
          enableCatchUp: false,
        },
  );

  const scrollToFocusedAsk = React.useCallback(
    (items: WsMessage[]) => {
      if (!focus_ask_id || didScrollToFocusRef.current) return;
      const index = items.findIndex((msg) => getAskId(msg) === focus_ask_id);
      if (index < 0 || !listRef.current) return;
      try {
        listRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
      } catch {
        return;
      }
      didScrollToFocusRef.current = true;
    },
    [focus_ask_id],
  );

  useEffect(() => {
    scrollToFocusedAsk(transcriptMessages);
  }, [transcriptMessages, scrollToFocusedAsk]);

  useEffect(() => {
    didScrollToFocusRef.current = false;
    hasOlderMessagesRef.current = true;
    isLoadingOlderRef.current = false;
    lastOlderRequestBeforeSeqRef.current = null;
    isNearBottomRef.current = true;
    prevMessageCountRef.current = 0;
    olderLoadRequestIdRef.current += 1;
    const current = useChatStore.getState().messages[conv_id] ?? EMPTY_MESSAGES;
    setCatchUpAfterSeq(current.length > 0 ? getMaxMessageSeq(current) : null);
  }, [conv_id, focus_ask_id]);

  useEffect(() => {
    if (!endpoint) return;
    const requestId = ++historyRequestGenerationRef.current;
    let cancelled = false;
    const isStale = () => cancelled || historyRequestGenerationRef.current !== requestId;
    Promise.all([
      fetchMessages(endpoint.base_url, endpoint.token, conv_id, { limit: INITIAL_MESSAGE_LIMIT }),
      loadAnsweredAsks(conv_id),
    ])
      .then(([msgs, answeredMap]) => {
        if (isStale()) return undefined;
        lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(msgs);
        lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(msgs);
        hasLoadedInitialMessagesRef.current = true;
        const merged = hydrateAnswered(msgs, answeredMap);
        const current = useChatStore.getState().messages[conv_id] ?? EMPTY_MESSAGES;
        if (shouldMergeInitialHistory(current, merged)) mergeMessages(conv_id, merged);
        else resetMessages(conv_id, merged);
        const storedMessages = useChatStore.getState().messages[conv_id] ?? merged;
        setCatchUpAfterSeq(getMaxMessageSeq(storedMessages));
        const storeConv = useChatStore.getState().conversations.find((c) => c.id === conv_id);
        void mirrorAskQuestionsToInbox({
          messages: merged,
          endpoint_id: endpoint_id ?? '',
          agent_id: storeConv?.agent_id ?? agent_id ?? '',
          agent_name: storeConv?.agent_name ?? agent_name,
          conversation_id: conv_id,
          addItem: addInboxItem,
        });
        if (!focus_ask_id || hasAskId(merged, focus_ask_id)) return undefined;
        return fetchMessages(endpoint.base_url, endpoint.token, conv_id, {
          around_ask_id: focus_ask_id,
          limit: FOCUS_MESSAGE_LIMIT,
        }).then((focusMsgs) => {
          if (isStale()) return;
          const focusMerged = hydrateAnswered(focusMsgs, answeredMap);
          mergeMessages(conv_id, focusMerged);
          void mirrorAskQuestionsToInbox({
            messages: focusMerged,
            endpoint_id: endpoint_id ?? '',
            agent_id: storeConv?.agent_id ?? agent_id ?? '',
            agent_name: storeConv?.agent_name ?? agent_name,
            conversation_id: conv_id,
            addItem: addInboxItem,
          });
        });
      })
      .catch((error: unknown) => {
        if (isStale()) return;
        recordDiagnosticsEvent('error', 'chat.history', 'failed to load chat history', {
          conv_id,
          endpoint_id,
          error,
        });
        hasLoadedInitialMessagesRef.current = true;
      });
    return () => {
      cancelled = true;
      historyRequestGenerationRef.current += 1;
    };
  }, [
    conv_id,
    endpoint,
    endpoint_id,
    agent_id,
    agent_name,
    inboxMirrorStableKey,
    resetMessages,
    mergeMessages,
    addInboxItem,
    focus_ask_id,
  ]);

  async function loadOlderMessages() {
    if (!endpoint || isLoadingOlderRef.current || !hasOlderMessagesRef.current) return;
    const firstLoadedSeq = messages[0]?.seq;
    if (firstLoadedSeq == null || firstLoadedSeq <= 1) {
      hasOlderMessagesRef.current = false;
      return;
    }
    if (lastOlderRequestBeforeSeqRef.current === firstLoadedSeq) return;
    lastOlderRequestBeforeSeqRef.current = firstLoadedSeq;
    isLoadingOlderRef.current = true;
    const olderRequestId = ++olderLoadRequestIdRef.current;
    const requestGeneration = historyRequestGenerationRef.current;
    const isStale = () => historyRequestGenerationRef.current !== requestGeneration;
    try {
      const older = await fetchMessages(endpoint.base_url, endpoint.token, conv_id, {
        before_seq: firstLoadedSeq,
        limit: OLDER_MESSAGE_LIMIT,
      });
      if (isStale()) return;
      if (older.length === 0 || older[0]?.seq <= 1) {
        hasOlderMessagesRef.current = false;
      }
      lastSeenAgentActivitySeqRef.current = Math.max(
        lastSeenAgentActivitySeqRef.current,
        getLatestAgentActivitySeq(older),
      );
      lastAnimatedAgentTextSeqRef.current = Math.max(
        lastAnimatedAgentTextSeqRef.current,
        getLatestAgentTextSeq(older),
      );
      prependMessages(conv_id, older);
    } catch (error: unknown) {
      if (isStale()) return;
      lastOlderRequestBeforeSeqRef.current = null;
      recordDiagnosticsEvent('error', 'chat.history', 'failed to load older chat history', {
        conv_id,
        endpoint_id,
        error,
      });
    } finally {
      if (olderLoadRequestIdRef.current === olderRequestId) {
        isLoadingOlderRef.current = false;
        if (isStale()) lastOlderRequestBeforeSeqRef.current = null;
      }
    }
  }

  const handleInputChange = (text: string) => {
    setInput(text);
    if (text.startsWith('/')) {
      setCommandPopupVisible(true);
    } else if (commandPopupVisible) {
      setCommandPopupVisible(false);
    }
  };

  const handleCommandSelect = (command: string) => {
    setInput(command + ' ');
    setCommandPopupVisible(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    const uploadedImages = pendingImages.filter((img) => img.status === 'uploaded' && img.fileId);
    if ((!text && uploadedImages.length === 0) || !endpoint) return;

    lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(messages);
    lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(messages);
    hasLoadedInitialMessagesRef.current = true;
    updateConversation(conv_id, { status: 'running' });
    setInput('');
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
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error: unknown) {
      recordDiagnosticsEvent('error', 'chat.send', 'failed to send message', {
        conv_id,
        endpoint_id,
        image_count: uploadedImages.length,
        error,
      });
      setIsAwaitingResponse(false);
    }
  };

  const handleStop = () => {
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
  };

  const isOffline = !endpoint || status === 'closed';
  const conversationStatus = conversation?.status ?? 'idle';
  const lastMsg = messages.at(-1);
  const shouldForceComplete =
    lastMsg?.role === 'tool_call' ||
    conversationStatus === 'completed' ||
    conversationStatus === 'failed';
  const isAgentRunning = isAwaitingResponse || conversationStatus === 'running';
  const composerDisabled = isOffline || isAgentRunning;

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
  }, [isAwaitingResponse, latestAgentActivitySeq, latestAgentSeq]);

  useEffect(() => {
    if (isAwaitingResponse && conversation && conversationStatus !== 'running') {
      setIsAwaitingResponse(false);
    }
  }, [conversationStatus, isAwaitingResponse, conversation]);

  function handleTranscriptScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    isNearBottomRef.current = distanceFromBottom < BOTTOM_STICKY_THRESHOLD;
    if (contentOffset.y < TOP_LOAD_THRESHOLD) void loadOlderMessages();
  }

  function handleContentSizeChange() {
    scrollToFocusedAsk(transcriptMessages);
    if (focus_ask_id && hasAskId(transcriptMessages, focus_ask_id)) return;
    const currentCount = transcriptMessages.length + (isAgentRunning ? 1 : 0);
    if (currentCount > prevMessageCountRef.current) {
      prevMessageCountRef.current = currentCount;
      if (isNearBottomRef.current) {
        listRef.current?.scrollToEnd({ animated: true });
      }
    }
  }

  function handleScrollToIndexFailed(info: { index: number; averageItemLength: number }) {
    if (!focus_ask_id || !hasAskId(transcriptMessages, focus_ask_id)) return;
    didScrollToFocusRef.current = false;
    listRef.current?.scrollToOffset({
      offset: Math.max(info.averageItemLength * info.index, 0),
      animated: false,
    });
    setTimeout(() => scrollToFocusedAsk(transcriptMessages), 50);
  }

  const badge = isOffline
    ? { label: 'OFFLINE', bg: '#1A1A1A', dot: '#FF4444' }
    : (STATUS_BADGE[conversation?.status ?? 'idle'] ?? STATUS_BADGE.idle);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ChatHeader title={navTitle} badge={badge} onBack={() => router.back()} />

        <ChatTranscriptList
          listRef={listRef}
          messages={transcriptMessages}
          isAgentRunning={isAgentRunning}
          incomingAgentActivitySeq={incomingAgentActivitySeq}
          activeTypewriterSeq={activeTypewriterSeq}
          shouldForceComplete={shouldForceComplete}
          serverUrl={endpoint?.base_url ?? ''}
          token={endpoint?.token ?? ''}
          onAnswer={sendAnswer}
          onAnswerMulti={sendAnswerMulti}
          imageUriForMessage={imageUriForMessage}
          onScroll={handleTranscriptScroll}
          onContentSizeChange={handleContentSizeChange}
          onScrollToIndexFailed={handleScrollToIndexFailed}
        />

        <CommandPopup
          visible={commandPopupVisible}
          onSelect={handleCommandSelect}
          onDismiss={() => setCommandPopupVisible(false)}
        />
        <View style={s.inputArea}>
          <ChatInputBar
            value={input}
            onChangeText={handleInputChange}
            onSend={() => void handleSend()}
            onPickImage={() => void pickImage()}
            onOpenCommands={() => setCommandPopupVisible(true)}
            disabled={composerDisabled}
            isAgentRunning={isAgentRunning}
            onStop={handleStop}
            placeholder={isOffline ? 'Agent offline...' : 'Message...'}
            pendingImages={pendingImages}
            onRemoveImage={removePendingImage}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

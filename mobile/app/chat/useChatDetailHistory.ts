import React, { useEffect, useRef, useState } from 'react';
import { type FlatList } from 'react-native';
import { EMPTY_MESSAGES } from '@/features/chat/chatDetailConstants';
import { fetchMessages } from '@/features/chat/services/chatService';
import {
  getMaxMessageSeq,
  hasAskId,
  hydrateAnswered,
  shouldMergeInitialHistory,
} from '@/features/chat/utils/chatMessageWindows';
import {
  collapseTodoToolCallSnapshots,
  type ChatTranscriptDisplayItem,
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
  isRenderableInChatTranscript,
} from '@/features/chat/utils/chatRenderState';
import { loadAnsweredAsks } from '@/features/inbox/services/inboxService';
import { mirrorAskQuestionsToInbox } from '@/features/inbox/utils/mirrorAskQuestionsToInbox';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import { useChatStore } from '@/store/chatStore';
import { useInboxStore } from '@/store/inboxStore';
import { type Endpoint, type WsMessage } from '@/types';
import {
  FOCUS_MESSAGE_LIMIT,
  getLatestWindowMinSeq,
  INITIAL_MESSAGE_LIMIT,
  OLDER_MESSAGE_LIMIT,
} from './chatDetailLimits';

type HistoryParams = {
  conv_id: string;
  endpoint: Endpoint | undefined;
  endpoint_id: string | undefined;
  agent_id: string | undefined;
  agent_name: string | undefined;
  focus_ask_id: string | undefined;
  messages: WsMessage[];
  inboxMirrorStableKey: string;
  listRef: React.RefObject<FlatList<ChatTranscriptDisplayItem> | null>;
  lastSeenAgentActivitySeqRef: React.MutableRefObject<number>;
  lastAnimatedAgentTextSeqRef: React.MutableRefObject<number>;
};

export function useChatDetailHistory({
  conv_id,
  endpoint,
  endpoint_id,
  agent_id,
  agent_name,
  focus_ask_id,
  messages,
  inboxMirrorStableKey,
  listRef,
  lastSeenAgentActivitySeqRef,
  lastAnimatedAgentTextSeqRef,
}: HistoryParams) {
  const [catchUpAfterSeq, setCatchUpAfterSeq] = useState<number | null>(() =>
    messages.length > 0 ? getMaxMessageSeq(messages) : null,
  );
  const [visibleMinSeq, setVisibleMinSeq] = useState<number | null>(() =>
    getLatestWindowMinSeq(messages, INITIAL_MESSAGE_LIMIT),
  );
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const isLoadingOlderRef = useRef(false);
  const hasOlderMessagesRef = useRef(true);
  const hasUserScrolledHistoryRef = useRef(false);
  const lastOlderRequestBeforeSeqRef = useRef<number | null>(null);
  const historyRequestGenerationRef = useRef(0);
  const olderLoadRequestIdRef = useRef(0);
  const olderLoadingTokenRef = useRef(0);
  const cachedOlderFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef(false);
  const hasLoadedInitialMessagesRef = useRef(messages.length > 0);

  const resetMessages = useChatStore((s) => s.resetMessages);
  const mergeMessages = useChatStore((s) => s.mergeMessages);
  const prependMessages = useChatStore((s) => s.prependMessages);
  const addInboxItem = useInboxStore((s) => s.addItem);

  function cancelCachedOlderFinish() {
    if (cachedOlderFrameRef.current == null) return;
    cancelAnimationFrame(cachedOlderFrameRef.current);
    cachedOlderFrameRef.current = null;
  }

  function startOlderLoading() {
    cancelCachedOlderFinish();
    const token = ++olderLoadingTokenRef.current;
    isLoadingOlderRef.current = true;
    if (isMountedRef.current) setIsLoadingOlder(true);
    return token;
  }

  function finishOlderLoading(token: number) {
    if (!isMountedRef.current || olderLoadingTokenRef.current !== token) return;
    isLoadingOlderRef.current = false;
    setIsLoadingOlder(false);
  }

  function finishCachedOlderLoading(token: number) {
    const frameId = requestAnimationFrame(() => {
      if (cachedOlderFrameRef.current === frameId) cachedOlderFrameRef.current = null;
      finishOlderLoading(token);
    });
    cachedOlderFrameRef.current = frameId;
  }

  const visibleMessages = React.useMemo(() => {
    if (visibleMinSeq == null) {
      return messages.slice(Math.max(messages.length - INITIAL_MESSAGE_LIMIT, 0));
    }
    return messages.filter((message) => message.seq >= visibleMinSeq);
  }, [messages, visibleMinSeq]);

  const transcriptMessages = React.useMemo(
    () => collapseTodoToolCallSnapshots(visibleMessages.filter(isRenderableInChatTranscript)),
    [visibleMessages],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelCachedOlderFinish();
      olderLoadingTokenRef.current += 1;
      olderLoadRequestIdRef.current += 1;
      isLoadingOlderRef.current = false;
    };
  }, []);

  useEffect(() => {
    cancelCachedOlderFinish();
    olderLoadingTokenRef.current += 1;
    hasOlderMessagesRef.current = true;
    isLoadingOlderRef.current = false;
    setIsLoadingOlder(false);
    lastOlderRequestBeforeSeqRef.current = null;
    hasUserScrolledHistoryRef.current = false;
    olderLoadRequestIdRef.current += 1;
    const current = useChatStore.getState().messages[conv_id] ?? EMPTY_MESSAGES;
    setVisibleMinSeq(getLatestWindowMinSeq(current, INITIAL_MESSAGE_LIMIT));
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
        setVisibleMinSeq(getLatestWindowMinSeq(storedMessages, INITIAL_MESSAGE_LIMIT));
        setCatchUpAfterSeq(getMaxMessageSeq(storedMessages));
        if (!focus_ask_id) {
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: false });
          });
        }
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
          const focusMinSeq = getLatestWindowMinSeq(focusMerged, focusMerged.length);
          setVisibleMinSeq((currentMinSeq) =>
            focusMinSeq == null
              ? currentMinSeq
              : Math.min(currentMinSeq ?? focusMinSeq, focusMinSeq),
          );
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
    listRef,
    lastSeenAgentActivitySeqRef,
    lastAnimatedAgentTextSeqRef,
  ]);

  async function loadOlderMessages() {
    if (!endpoint || isLoadingOlderRef.current || !hasOlderMessagesRef.current) return;
    if (!hasUserScrolledHistoryRef.current) return;
    const firstLoadedSeq = visibleMinSeq ?? messages[0]?.seq;
    if (firstLoadedSeq == null || firstLoadedSeq <= 1) {
      hasOlderMessagesRef.current = false;
      return;
    }
    if (lastOlderRequestBeforeSeqRef.current === firstLoadedSeq) return;
    const loadingToken = startOlderLoading();
    const cachedOlder = messages.filter((message) => message.seq < firstLoadedSeq);
    if (cachedOlder.length > 0) {
      const nextCachedWindow = cachedOlder.slice(
        Math.max(cachedOlder.length - OLDER_MESSAGE_LIMIT, 0),
      );
      const nextMinSeq = nextCachedWindow[0]?.seq;
      if (nextMinSeq != null) {
        setVisibleMinSeq(nextMinSeq);
        if (nextMinSeq <= 1) hasOlderMessagesRef.current = false;
      }
      finishCachedOlderLoading(loadingToken);
      return;
    }
    lastOlderRequestBeforeSeqRef.current = firstLoadedSeq;
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
      if (older[0]?.seq != null) setVisibleMinSeq(older[0].seq);
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
        finishOlderLoading(loadingToken);
        if (isStale()) lastOlderRequestBeforeSeqRef.current = null;
      }
    }
  }

  return {
    catchUpAfterSeq,
    transcriptMessages,
    isLoadingOlder,
    hasUserScrolledHistoryRef,
    hasLoadedInitialMessagesRef,
    loadOlderMessages,
  };
}

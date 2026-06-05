import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type FlatList } from 'react-native';
import {
  fetchTranscriptTurns,
  fetchTurnHiddenMessages,
} from '@/features/chat/services/transcriptService';
import type { TranscriptItem, TranscriptPage } from '@/features/chat/types';
import { getMaxMessageSeq, hydrateAnswered } from '@/features/chat/utils/chatMessageWindows';
import {
  collapseTodoToolCallSnapshots,
  type ChatTranscriptDisplayItem,
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
  isRenderableInChatTranscript,
} from '@/features/chat/utils/chatRenderState';
import { buildServerTranscriptDisplayItems } from '@/features/chat/utils/serverTranscriptDisplayItems';
import { loadAnsweredAsks } from '@/features/inbox/services/inboxService';
import { mirrorAskQuestionsToInbox } from '@/features/inbox/utils/mirrorAskQuestionsToInbox';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import { useChatStore } from '@/store/chatStore';
import { useInboxStore } from '@/store/inboxStore';
import { type Endpoint, type WsMessage } from '@/types';
import { INITIAL_TURN_LIMIT, OLDER_TURN_LIMIT } from './chatDetailLimits';

type HiddenTurnState = {
  isLoading: boolean;
  messages: WsMessage[];
};

type ServerTranscriptParams = {
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

function visibleMessagesFromItems(items: TranscriptItem[]): WsMessage[] {
  const messages: WsMessage[] = [];
  for (const item of items) {
    if (item.kind === 'prelude_raw' || item.kind === 'current_turn_raw') {
      messages.push(...item.messages);
      continue;
    }
    messages.push(item.user, ...item.asks);
    if (item.final_agent) messages.push(item.final_agent);
  }
  return messages.sort((a, b) => a.seq - b.seq);
}

function transcriptHighWaterSeq(items: TranscriptItem[]): number | null {
  let maxSeq: number | null = null;
  for (const item of items) {
    const itemSeq =
      item.kind === 'turn_summary'
        ? item.end_seq
        : item.messages.length > 0
          ? getMaxMessageSeq(item.messages)
          : item.kind === 'current_turn_raw'
            ? item.start_seq
            : null;
    if (itemSeq != null) maxSeq = Math.max(maxSeq ?? itemSeq, itemSeq);
  }
  return maxSeq;
}

function hydrateTranscriptItems(
  items: TranscriptItem[],
  answeredMap: Map<string, { choice_id?: string; choice_ids?: Record<string, string> }>,
): TranscriptItem[] {
  const hydrateMessages = (messages: WsMessage[]) => hydrateAnswered(messages, answeredMap);
  return items.map((item) => {
    if (item.kind === 'prelude_raw') {
      return { ...item, messages: hydrateMessages(item.messages) };
    }
    if (item.kind === 'current_turn_raw') {
      return { ...item, messages: hydrateMessages(item.messages) };
    }
    const hydratedUser = hydrateMessages([item.user])[0] ?? item.user;
    const hydratedFinal = item.final_agent
      ? (hydrateMessages([item.final_agent])[0] ?? item.final_agent)
      : item.final_agent;
    return {
      ...item,
      user: hydratedUser,
      asks: hydrateMessages(item.asks),
      final_agent: hydratedFinal,
    };
  });
}

function prependTranscriptItems(current: TranscriptItem[], older: TranscriptItem[]) {
  const seen = new Set(current.map((item) => ('turn_id' in item ? item.turn_id : 'prelude')));
  const next = older.filter((item) => {
    const key = 'turn_id' in item ? item.turn_id : 'prelude';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...next, ...current];
}

function loadedHiddenMessages(hiddenByTurnId: Record<string, HiddenTurnState>): WsMessage[] {
  return Object.values(hiddenByTurnId).flatMap((state) => state.messages);
}

export function useChatDetailServerTranscript({
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
}: ServerTranscriptParams) {
  const [pageItems, setPageItems] = useState<TranscriptItem[]>([]);
  const [oldestTurnId, setOldestTurnId] = useState<string | null>(null);
  const [catchUpAfterSeq, setCatchUpAfterSeq] = useState<number | null>(null);
  const [serverMaxSeq, setServerMaxSeq] = useState<number | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hiddenByTurnId, setHiddenByTurnId] = useState<Record<string, HiddenTurnState>>({});

  const isLoadingOlderRef = useRef(false);
  const hasOlderTurnsRef = useRef(true);
  const hasUserScrolledHistoryRef = useRef(false);
  const hasLoadedInitialMessagesRef = useRef(false);
  const lastOlderRequestBeforeTurnRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const olderLoadRequestIdRef = useRef(0);
  const isMountedRef = useRef(false);

  const mergeMessages = useChatStore((s) => s.mergeMessages);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const addInboxItem = useInboxStore((s) => s.addItem);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestGenerationRef.current += 1;
      olderLoadRequestIdRef.current += 1;
      isLoadingOlderRef.current = false;
    };
  }, []);

  useEffect(() => {
    requestGenerationRef.current += 1;
    olderLoadRequestIdRef.current += 1;
    hasOlderTurnsRef.current = true;
    hasUserScrolledHistoryRef.current = false;
    lastOlderRequestBeforeTurnRef.current = null;
    hasLoadedInitialMessagesRef.current = false;
    isLoadingOlderRef.current = false;
    setIsLoadingOlder(false);
    setPageItems([]);
    setOldestTurnId(null);
    setCatchUpAfterSeq(null);
    setServerMaxSeq(null);
    setHiddenByTurnId({});
  }, [conv_id, focus_ask_id]);

  useEffect(() => {
    if (!endpoint) return;
    const requestId = ++requestGenerationRef.current;
    let cancelled = false;
    const isStale = () => cancelled || requestGenerationRef.current !== requestId;

    Promise.all([
      fetchTranscriptTurns(endpoint.base_url, endpoint.token, conv_id, {
        limit: INITIAL_TURN_LIMIT,
        aroundAskId: focus_ask_id,
      }),
      loadAnsweredAsks(conv_id),
    ])
      .then(([page, answeredMap]) => {
        if (isStale()) return;
        commitInitialPage(page, answeredMap);
      })
      .catch((error: unknown) => {
        if (isStale()) return;
        recordDiagnosticsEvent('error', 'chat.transcript', 'failed to load transcript turns', {
          conv_id,
          endpoint_id,
          error,
        });
        hasLoadedInitialMessagesRef.current = true;
      });

    function commitInitialPage(
      page: TranscriptPage,
      answeredMap: Map<string, { choice_id?: string; choice_ids?: Record<string, string> }>,
    ) {
      const hydratedItems = hydrateTranscriptItems(page.items, answeredMap);
      const visibleMessages = visibleMessagesFromItems(hydratedItems);
      const highWaterSeq = transcriptHighWaterSeq(hydratedItems);

      setPageItems(hydratedItems);
      setOldestTurnId(page.page_info.oldest_turn_id);
      hasOlderTurnsRef.current = page.page_info.has_older;
      setServerMaxSeq(highWaterSeq ?? 0);
      setCatchUpAfterSeq(highWaterSeq);
      hasLoadedInitialMessagesRef.current = true;

      lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(visibleMessages);
      lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(visibleMessages);
      if (visibleMessages.length > 0) mergeMessages(conv_id, visibleMessages);
      updateConversation(conv_id, { status: page.status });

      const storeConv = useChatStore.getState().conversations.find((c) => c.id === conv_id);
      void mirrorAskQuestionsToInbox({
        messages: visibleMessages,
        endpoint_id: endpoint_id ?? '',
        agent_id: storeConv?.agent_id ?? agent_id ?? '',
        agent_name: storeConv?.agent_name ?? agent_name,
        conversation_id: conv_id,
        addItem: addInboxItem,
      });

      if (!focus_ask_id) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
        });
      }
    }

    return () => {
      cancelled = true;
      requestGenerationRef.current += 1;
    };
  }, [
    conv_id,
    endpoint,
    endpoint_id,
    agent_id,
    agent_name,
    inboxMirrorStableKey,
    focus_ask_id,
    mergeMessages,
    updateConversation,
    addInboxItem,
    listRef,
    lastSeenAgentActivitySeqRef,
    lastAnimatedAgentTextSeqRef,
  ]);

  async function loadOlderMessages() {
    if (!endpoint || isLoadingOlderRef.current || !hasOlderTurnsRef.current) return;
    if (!hasUserScrolledHistoryRef.current || !oldestTurnId) return;
    if (lastOlderRequestBeforeTurnRef.current === oldestTurnId) return;

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);
    lastOlderRequestBeforeTurnRef.current = oldestTurnId;
    const olderRequestId = ++olderLoadRequestIdRef.current;
    const requestGeneration = requestGenerationRef.current;
    const isStale = () => requestGenerationRef.current !== requestGeneration;

    try {
      const [page, answeredMap] = await Promise.all([
        fetchTranscriptTurns(endpoint.base_url, endpoint.token, conv_id, {
          limit: OLDER_TURN_LIMIT,
          beforeTurn: oldestTurnId,
        }),
        loadAnsweredAsks(conv_id),
      ]);
      if (isStale()) return;
      const hydratedItems = hydrateTranscriptItems(page.items, answeredMap);
      const visibleMessages = visibleMessagesFromItems(hydratedItems);
      setPageItems((current) => prependTranscriptItems(current, hydratedItems));
      setOldestTurnId(page.page_info.oldest_turn_id);
      hasOlderTurnsRef.current = page.page_info.has_older;
      if (!page.page_info.has_older) lastOlderRequestBeforeTurnRef.current = null;
      lastSeenAgentActivitySeqRef.current = Math.max(
        lastSeenAgentActivitySeqRef.current,
        getLatestAgentActivitySeq(visibleMessages),
      );
      lastAnimatedAgentTextSeqRef.current = Math.max(
        lastAnimatedAgentTextSeqRef.current,
        getLatestAgentTextSeq(visibleMessages),
      );
      if (visibleMessages.length > 0) mergeMessages(conv_id, visibleMessages);
    } catch (error: unknown) {
      if (isStale()) return;
      lastOlderRequestBeforeTurnRef.current = null;
      recordDiagnosticsEvent('error', 'chat.transcript', 'failed to load older transcript turns', {
        conv_id,
        endpoint_id,
        error,
      });
    } finally {
      if (olderLoadRequestIdRef.current === olderRequestId) {
        isLoadingOlderRef.current = false;
        if (isMountedRef.current) setIsLoadingOlder(false);
        if (isStale()) lastOlderRequestBeforeTurnRef.current = null;
      }
    }
  }

  async function loadServerWorkedMessages(turnId: string) {
    if (!endpoint) return;
    const existing = hiddenByTurnId[turnId];
    if (existing?.isLoading || existing?.messages.length) return;

    setHiddenByTurnId((current) => ({
      ...current,
      [turnId]: { isLoading: true, messages: current[turnId]?.messages ?? [] },
    }));
    try {
      const response = await fetchTurnHiddenMessages(
        endpoint.base_url,
        endpoint.token,
        conv_id,
        turnId,
      );
      const messages = response.messages;
      setHiddenByTurnId((current) => ({
        ...current,
        [turnId]: { isLoading: false, messages },
      }));
      lastSeenAgentActivitySeqRef.current = Math.max(
        lastSeenAgentActivitySeqRef.current,
        getLatestAgentActivitySeq(messages),
      );
      lastAnimatedAgentTextSeqRef.current = Math.max(
        lastAnimatedAgentTextSeqRef.current,
        getLatestAgentTextSeq(messages),
      );
      if (messages.length > 0) mergeMessages(conv_id, messages);
    } catch (error: unknown) {
      setHiddenByTurnId((current) => ({
        ...current,
        [turnId]: { isLoading: false, messages: current[turnId]?.messages ?? [] },
      }));
      recordDiagnosticsEvent('error', 'chat.transcript', 'failed to load worked row messages', {
        conv_id,
        endpoint_id,
        turn_id: turnId,
        error,
      });
    }
  }

  const hiddenMessages = useMemo(() => loadedHiddenMessages(hiddenByTurnId), [hiddenByTurnId]);
  const liveTailMessages = useMemo(() => {
    if (serverMaxSeq == null) return [];
    return collapseTodoToolCallSnapshots(
      messages.filter(
        (message) => message.seq > serverMaxSeq && isRenderableInChatTranscript(message),
      ),
    );
  }, [messages, serverMaxSeq]);

  const transcriptDisplayItems = useMemo(() => {
    const baseItems = buildServerTranscriptDisplayItems(pageItems).map((item) => {
      if (item.kind !== 'server_worked') return item;
      const state = hiddenByTurnId[item.turnId];
      return {
        ...item,
        isLoading: state?.isLoading,
        messages: collapseTodoToolCallSnapshots(
          (state?.messages ?? []).filter(isRenderableInChatTranscript),
        ),
      };
    });
    return [
      ...baseItems,
      ...liveTailMessages.map((message) => ({ kind: 'message' as const, message })),
    ];
  }, [hiddenByTurnId, liveTailMessages, pageItems]);

  const transcriptMessages = useMemo(
    () =>
      transcriptDisplayItems.flatMap((item) =>
        item.kind === 'message' ? [item.message] : item.messages,
      ),
    [transcriptDisplayItems],
  );

  const toolResultMessages = useMemo(
    () => [...messages, ...hiddenMessages],
    [hiddenMessages, messages],
  );

  return {
    catchUpAfterSeq,
    transcriptMessages,
    transcriptDisplayItems,
    toolResultMessages,
    isLoadingOlder,
    hasUserScrolledHistoryRef,
    hasLoadedInitialMessagesRef,
    loadOlderMessages,
    loadServerWorkedMessages,
  };
}

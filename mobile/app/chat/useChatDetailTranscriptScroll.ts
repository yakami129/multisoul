import { useEffect, useRef, useCallback } from 'react';
import {
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { getAskId } from '@/features/chat/utils/chatMessageWindows';
import {
  getChatTranscriptDisplayItemKey,
  type ChatTranscriptDisplayItem,
} from '@/features/chat/utils/chatRenderState';
import { BOTTOM_STICKY_THRESHOLD, TOP_LOAD_THRESHOLD } from './chatDetailLimits';

type TranscriptScrollParams = {
  conv_id: string;
  listRef: React.RefObject<FlatList<ChatTranscriptDisplayItem> | null>;
  focus_ask_id: string | undefined;
  transcriptItems: ChatTranscriptDisplayItem[];
  isAgentRunning: boolean;
  hasUserScrolledHistoryRef: React.MutableRefObject<boolean>;
  loadOlderMessages: () => Promise<void>;
};

function getDisplayItemAskId(item: ChatTranscriptDisplayItem): string | undefined {
  return item.kind === 'message' ? getAskId(item.message) : undefined;
}

function hasDisplayItemAskId(items: ChatTranscriptDisplayItem[], askId: string): boolean {
  return items.some((item) => getDisplayItemAskId(item) === askId);
}

export function useChatDetailTranscriptScroll({
  conv_id,
  listRef,
  focus_ask_id,
  transcriptItems,
  isAgentRunning,
  hasUserScrolledHistoryRef,
  loadOlderMessages,
}: TranscriptScrollParams) {
  const prevMessageCountRef = useRef(0);
  const lastScrolledFocusTargetRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstVisibleDisplayItemKeyRef = useRef<string | null>(null);
  const firstVisibleDisplayItemIndexRef = useRef<number | null>(null);
  const pendingInitialBottomScrollRef = useRef(!focus_ask_id);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current === null) return;
    clearTimeout(retryTimeoutRef.current);
    retryTimeoutRef.current = null;
  }, []);

  const scrollToFocusedAsk = useCallback(
    (items: ChatTranscriptDisplayItem[]) => {
      const focusTargetKey = focus_ask_id ? `${conv_id}:${focus_ask_id}` : null;
      if (!focus_ask_id || lastScrolledFocusTargetRef.current === focusTargetKey) return;
      const index = items.findIndex((item) => getDisplayItemAskId(item) === focus_ask_id);
      if (index < 0 || !listRef.current) return;
      try {
        listRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
      } catch {
        return;
      }
      lastScrolledFocusTargetRef.current = focusTargetKey;
    },
    [conv_id, focus_ask_id, listRef],
  );

  useEffect(() => {
    scrollToFocusedAsk(transcriptItems);
  }, [transcriptItems, scrollToFocusedAsk]);

  // Initial / post-send placement uses scrollToEnd, which does not depend on the
  // target row being measured. scrollToIndex(lastAgentText) silently fails via the
  // async onScrollToIndexFailed path whenever the target is below FlatList's
  // initialNumToRender window (the common case for any conversation longer than a
  // screen), leaving the list stuck near the top. scrollToEnd always lands at the
  // newest content (the latest AI reply is the last item in idle/completed turns).
  const scrollToBottom = useCallback(
    (animated: boolean) => {
      listRef.current?.scrollToEnd({ animated });
    },
    [listRef],
  );

  // Async transcript pages can populate / grow FlatList data across several frames
  // without a reliable follow-up onContentSizeChange on some RN builds; keep
  // re-pinning to the bottom until the user takes control of the scroll position.
  useEffect(() => {
    if (focus_ask_id || hasUserScrolledHistoryRef.current) return;
    if (!pendingInitialBottomScrollRef.current || transcriptItems.length === 0) return;

    const settleToBottom = () => {
      if (!pendingInitialBottomScrollRef.current || hasUserScrolledHistoryRef.current) return;
      scrollToBottom(false);
    };

    const raf = requestAnimationFrame(settleToBottom);
    const retry100 = setTimeout(settleToBottom, 100);
    const retry300 = setTimeout(settleToBottom, 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(retry100);
      clearTimeout(retry300);
    };
  }, [focus_ask_id, transcriptItems, scrollToBottom, hasUserScrolledHistoryRef]);

  useEffect(() => {
    lastScrolledFocusTargetRef.current = null;
    clearRetryTimeout();
    isNearBottomRef.current = true;
    firstVisibleDisplayItemKeyRef.current = null;
    firstVisibleDisplayItemIndexRef.current = null;
    prevMessageCountRef.current = 0;
    pendingInitialBottomScrollRef.current = !focus_ask_id;
    return clearRetryTimeout;
  }, [clearRetryTimeout, conv_id, focus_ask_id]);

  function handleTranscriptScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (pendingInitialBottomScrollRef.current && !hasUserScrolledHistoryRef.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    isNearBottomRef.current = distanceFromBottom < BOTTOM_STICKY_THRESHOLD;
    if (hasUserScrolledHistoryRef.current && contentOffset.y < TOP_LOAD_THRESHOLD) {
      void loadOlderMessages();
    }
  }

  function handleTranscriptScrollBeginDrag() {
    hasUserScrolledHistoryRef.current = true;
    // User took control of the scroll position: stop force-pinning to the bottom
    // and hand off to the isNearBottom follow logic below.
    pendingInitialBottomScrollRef.current = false;
  }

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ChatTranscriptDisplayItem>[] }) => {
      const firstVisibleItem = viewableItems.find((token) => token.isViewable && token.item);
      if (!firstVisibleItem) return;
      firstVisibleDisplayItemKeyRef.current = getChatTranscriptDisplayItemKey(
        firstVisibleItem.item,
      );
      firstVisibleDisplayItemIndexRef.current =
        typeof firstVisibleItem.index === 'number' ? firstVisibleItem.index : null;
    },
    [],
  );

  function handleContentSizeChange() {
    scrollToFocusedAsk(transcriptItems);
    const currentCount = transcriptItems.length + (isAgentRunning ? 1 : 0);
    if (pendingInitialBottomScrollRef.current && transcriptItems.length > 0) {
      prevMessageCountRef.current = currentCount;
      if (!hasUserScrolledHistoryRef.current) {
        // Keep pinning to the bottom while content keeps growing (async pages,
        // late row measurement). pendingInitialBottomScrollRef is released only
        // when the user drags, so we recover even if data arrives over many frames.
        scrollToBottom(false);
        return;
      }
      pendingInitialBottomScrollRef.current = false;
    }
    if (
      !isNearBottomRef.current &&
      firstVisibleDisplayItemKeyRef.current &&
      firstVisibleDisplayItemIndexRef.current !== null
    ) {
      const anchorIndex = transcriptItems.findIndex(
        (item) => getChatTranscriptDisplayItemKey(item) === firstVisibleDisplayItemKeyRef.current,
      );
      if (anchorIndex >= 0 && anchorIndex !== firstVisibleDisplayItemIndexRef.current) {
        listRef.current?.scrollToIndex({
          index: anchorIndex,
          animated: false,
          viewPosition: 0,
        });
        return;
      }
    }
    if (focus_ask_id && hasDisplayItemAskId(transcriptItems, focus_ask_id)) return;
    if (currentCount > prevMessageCountRef.current) {
      prevMessageCountRef.current = currentCount;
      if (isNearBottomRef.current) {
        listRef.current?.scrollToEnd({ animated: true });
      }
    }
  }

  const forceScrollToEnd = useCallback(() => {
    // Sending re-pins to the bottom regardless of where the user was reading, so
    // the just-sent message and the streamed reply stay visible. handleSend posts
    // to the server (no optimistic local append), so the actual message arrives a
    // frame later via WebSocket; re-arming the pin makes that growth follow to the
    // bottom too.
    isNearBottomRef.current = true;
    hasUserScrolledHistoryRef.current = false;
    pendingInitialBottomScrollRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  }, [listRef, hasUserScrolledHistoryRef]);

  function handleScrollToIndexFailed(info: { index: number; averageItemLength: number }) {
    if (!focus_ask_id) {
      if (pendingInitialBottomScrollRef.current) {
        listRef.current?.scrollToEnd({ animated: false });
      }
      return;
    }
    if (!hasDisplayItemAskId(transcriptItems, focus_ask_id)) return;
    lastScrolledFocusTargetRef.current = null;
    clearRetryTimeout();
    listRef.current?.scrollToOffset({
      offset: Math.max(info.averageItemLength * info.index, 0),
      animated: false,
    });
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      scrollToFocusedAsk(transcriptItems);
    }, 50);
  }

  return {
    handleTranscriptScroll,
    handleTranscriptScrollBeginDrag,
    handleViewableItemsChanged,
    handleContentSizeChange,
    handleScrollToIndexFailed,
    forceScrollToEnd,
  };
}

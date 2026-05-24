import { useEffect, useRef, useCallback } from 'react';
import { type FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { getAskId, hasAskId } from '@/features/chat/utils/chatMessageWindows';
import { type WsMessage } from '@/types';
import { BOTTOM_STICKY_THRESHOLD, TOP_LOAD_THRESHOLD } from './chatDetailLimits';

type TranscriptScrollParams = {
  listRef: React.RefObject<FlatList<WsMessage> | null>;
  focus_ask_id: string | undefined;
  transcriptMessages: WsMessage[];
  isAgentRunning: boolean;
  hasUserScrolledHistoryRef: React.MutableRefObject<boolean>;
  loadOlderMessages: () => Promise<void>;
};

export function useChatDetailTranscriptScroll({
  listRef,
  focus_ask_id,
  transcriptMessages,
  isAgentRunning,
  hasUserScrolledHistoryRef,
  loadOlderMessages,
}: TranscriptScrollParams) {
  const prevMessageCountRef = useRef(0);
  const didScrollToFocusRef = useRef(false);
  const isNearBottomRef = useRef(true);

  const scrollToFocusedAsk = useCallback(
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
    [focus_ask_id, listRef],
  );

  useEffect(() => {
    scrollToFocusedAsk(transcriptMessages);
  }, [transcriptMessages, scrollToFocusedAsk]);

  useEffect(() => {
    didScrollToFocusRef.current = false;
    isNearBottomRef.current = true;
    prevMessageCountRef.current = 0;
  }, [focus_ask_id]);

  function handleTranscriptScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    isNearBottomRef.current = distanceFromBottom < BOTTOM_STICKY_THRESHOLD;
    if (hasUserScrolledHistoryRef.current && contentOffset.y < TOP_LOAD_THRESHOLD) {
      void loadOlderMessages();
    }
  }

  function handleTranscriptScrollBeginDrag() {
    hasUserScrolledHistoryRef.current = true;
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

  return {
    handleTranscriptScroll,
    handleTranscriptScrollBeginDrag,
    handleContentSizeChange,
    handleScrollToIndexFailed,
  };
}

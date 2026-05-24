import React from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, View } from 'react-native';
import { WAITING_MESSAGE } from '@/features/chat/chatDetailConstants';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import { getAskId } from '@/features/chat/utils/chatMessageWindows';
import { type WsMessage } from '@/types';
import { s } from './styles';

interface Props {
  listRef: React.RefObject<FlatList<WsMessage> | null>;
  messages: WsMessage[];
  isAgentRunning: boolean;
  incomingAgentActivitySeq: number | null;
  activeTypewriterSeq: number | null;
  shouldForceComplete: boolean;
  serverUrl: string;
  token: string;
  onAnswer: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti: (ask_id: string, choice_ids: Record<string, string>) => void;
  imageUriForMessage: (msg: WsMessage) => string | undefined;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: () => void;
  onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void;
}

export default function ChatTranscriptList({
  listRef,
  messages,
  isAgentRunning,
  incomingAgentActivitySeq,
  activeTypewriterSeq,
  shouldForceComplete,
  serverUrl,
  token,
  onAnswer,
  onAnswerMulti,
  imageUriForMessage,
  onScroll,
  onContentSizeChange,
  onScrollToIndexFailed,
}: Props) {
  const renderMessage = ({ item: msg }: { item: WsMessage }) => {
    const askId = getAskId(msg);
    return (
      <View testID={askId ? `chat-ask-${askId}` : undefined}>
        <MessageBubble
          msg={msg}
          typewriter={msg.seq === activeTypewriterSeq}
          forceComplete={msg.seq === activeTypewriterSeq && shouldForceComplete}
          onAnswer={onAnswer}
          onAnswerMulti={onAnswerMulti}
          imageUri={imageUriForMessage(msg)}
          waiting={false}
          serverUrl={serverUrl}
          token={token}
        />
      </View>
    );
  };

  return (
    <FlatList
      ref={listRef}
      style={s.scroll}
      contentContainerStyle={s.scrollContent}
      data={messages}
      keyExtractor={(msg) => `${msg.seq}`}
      renderItem={renderMessage}
      ListFooterComponent={
        isAgentRunning && incomingAgentActivitySeq === null ? (
          <MessageBubble msg={WAITING_MESSAGE} waiting />
        ) : null
      }
      onScroll={onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={onContentSizeChange}
      onScrollToIndexFailed={onScrollToIndexFailed}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
    />
  );
}

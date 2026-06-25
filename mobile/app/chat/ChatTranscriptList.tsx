import { ChevronDown, ChevronUp } from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
  View,
} from 'react-native';
import { WAITING_MESSAGE } from '@/features/chat/chatDetailConstants';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import { ToolCallRow } from '@/features/chat/components/ToolCallRow';
import type { UserImageAttachment } from '@/features/chat/components/UserImageAttachments';
import { getAskId } from '@/features/chat/utils/chatMessageWindows';
import {
  buildCompletedTranscriptDisplayItems,
  getChatTranscriptDisplayItemKey,
  type ChatTranscriptDisplayItem,
} from '@/features/chat/utils/chatRenderState';
import { brandColors } from '@/theme/brandRefresh';
import {
  type Conversation,
  type ToolCallPayload,
  type ToolResultPayload,
  type UserTextPayload,
  type WsMessage,
} from '@/types';
import { s } from './styles';

interface Props {
  listRef: React.RefObject<FlatList<ChatTranscriptDisplayItem> | null>;
  messages: WsMessage[];
  displayItems?: ChatTranscriptDisplayItem[];
  conversationStatus: Conversation['status'];
  isLoadingOlder: boolean;
  isAgentRunning: boolean;
  incomingAgentActivitySeq: number | null;
  activeTypewriterSeq: number | null;
  shouldForceComplete: boolean;
  serverUrl: string;
  token: string;
  toolResultMessages?: WsMessage[];
  onLoadServerWorkedMessages?: (turnId: string) => void;
  onAnswer: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti: (ask_id: string, choice_ids: Record<string, string>) => void;
  imageUriForMessage: (msg: WsMessage) => string | undefined;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: () => void;
  onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void;
  onViewableItemsChanged?: (info: {
    viewableItems: ViewToken<ChatTranscriptDisplayItem>[];
    changed: ViewToken<ChatTranscriptDisplayItem>[];
  }) => void;
}

export default function ChatTranscriptList({
  listRef,
  messages,
  displayItems: providedDisplayItems,
  conversationStatus,
  isLoadingOlder,
  isAgentRunning,
  incomingAgentActivitySeq,
  activeTypewriterSeq,
  shouldForceComplete,
  serverUrl,
  token,
  toolResultMessages,
  onLoadServerWorkedMessages,
  onAnswer,
  onAnswerMulti,
  imageUriForMessage,
  onScroll,
  onScrollBeginDrag,
  onContentSizeChange,
  onScrollToIndexFailed,
  onViewableItemsChanged,
}: Props) {
  const [expandedWorkedIds, setExpandedWorkedIds] = React.useState<Set<string>>(() => new Set());
  const toolResultsByCallId = React.useMemo(() => {
    const results = new Map<string, ToolResultPayload>();
    for (const message of toolResultMessages ?? messages) {
      if (message.role !== 'tool_result') continue;
      const result = message.payload as ToolResultPayload;
      results.set(result.call_id, result);
    }
    return results;
  }, [messages, toolResultMessages]);

  const computedDisplayItems = React.useMemo(
    () => buildCompletedTranscriptDisplayItems(messages, conversationStatus),
    [conversationStatus, messages],
  );
  const displayItems = providedDisplayItems ?? computedDisplayItems;

  type WorkedDisplayItem = Extract<ChatTranscriptDisplayItem, { kind: 'worked' | 'server_worked' }>;

  const toggleWorkedItem = React.useCallback(
    (item: WorkedDisplayItem) => {
      setExpandedWorkedIds((current) => {
        const next = new Set(current);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
          if (item.kind === 'server_worked') {
            onLoadServerWorkedMessages?.(item.turnId);
          }
        }
        return next;
      });
    },
    [onLoadServerWorkedMessages],
  );

  const imageGroupDisplayMessage = (messages: WsMessage[]) =>
    [...messages]
      .reverse()
      .find((message) => ((message.payload as UserTextPayload).text ?? '').trim().length > 0) ??
    messages[messages.length - 1];

  const imageAttachmentsForMessages = (imageMessages: WsMessage[]): UserImageAttachment[] =>
    imageMessages.map((message) => {
      const payload = message.payload as UserTextPayload;
      return {
        seq: message.seq,
        fileId: payload.file_id,
        imageUri: imageUriForMessage(message),
      };
    });

  const renderMessage = (msg: WsMessage) => {
    const askId = getAskId(msg);
    if (msg.role === 'tool_call') {
      const call = msg.payload as ToolCallPayload;
      return (
        <View testID={askId ? `chat-ask-${askId}` : undefined}>
          <ToolCallRow call={call} result={toolResultsByCallId.get(call.call_id)} />
        </View>
      );
    }
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

  const renderDisplayItem = ({ item }: { item: ChatTranscriptDisplayItem }) => {
    if (item.kind === 'message') return renderMessage(item.message);
    if (item.kind === 'user_image_group') {
      const msg = imageGroupDisplayMessage(item.messages);
      return (
        <MessageBubble
          msg={msg}
          imageAttachments={imageAttachmentsForMessages(item.messages)}
          waiting={false}
          serverUrl={serverUrl}
          token={token}
        />
      );
    }

    const expanded = expandedWorkedIds.has(item.id);
    return (
      <View>
        <Pressable
          testID="worked-row"
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ expanded }}
          style={s.workedRow}
          onPress={() => toggleWorkedItem(item)}
        >
          <Text style={s.workedText}>{item.label}</Text>
          {expanded ? (
            <ChevronUp size={16} color={brandColors.textSoft} />
          ) : (
            <ChevronDown size={16} color={brandColors.textSoft} />
          )}
        </Pressable>
        {expanded ? (
          <View style={s.workedExpandedItems}>
            {item.kind === 'server_worked' && item.isLoading ? (
              <ActivityIndicator testID="worked-row-loading-indicator" color={brandColors.cyan} />
            ) : null}
            {item.messages.map((message) => (
              <View key={message.seq}>{renderMessage(message)}</View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderOlderLoading = () =>
    isLoadingOlder ? (
      <View testID="older-messages-loading" style={s.olderMessagesLoading}>
        <ActivityIndicator testID="older-messages-loading-indicator" color={brandColors.cyan} />
      </View>
    ) : null;

  return (
    <FlatList
      ref={listRef}
      style={s.scroll}
      contentContainerStyle={s.scrollContent}
      data={displayItems}
      keyExtractor={getChatTranscriptDisplayItemKey}
      renderItem={renderDisplayItem}
      ListHeaderComponent={isLoadingOlder ? renderOlderLoading : null}
      ListFooterComponent={
        isAgentRunning && incomingAgentActivitySeq === null ? (
          <MessageBubble msg={WAITING_MESSAGE} waiting />
        ) : null
      }
      onScroll={onScroll}
      onScrollBeginDrag={onScrollBeginDrag}
      scrollEventThrottle={16}
      onContentSizeChange={onContentSizeChange}
      onScrollToIndexFailed={onScrollToIndexFailed}
      onViewableItemsChanged={onViewableItemsChanged}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
    />
  );
}

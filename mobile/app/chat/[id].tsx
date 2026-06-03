import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, type FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EMPTY_MESSAGES, STATUS_BADGE } from '@/features/chat/chatDetailConstants';
import ChatInputBar from '@/features/chat/components/ChatInputBar';
import CommandPopup, { type ComposerSheetMode } from '@/features/chat/components/CommandPopup';
import { ModelSelector, useChatModelSelector } from '@/features/chat/components/ModelSelector';
import { resolveUserMessageImageUri } from '@/features/chat/services/chatService';
import {
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
} from '@/features/chat/utils/chatRenderState';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useChatStore } from '@/store/chatStore';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { useEndpointStore } from '@/store/endpointStore';
import { type WsMessage } from '@/types';
import ChatHeader from './ChatHeader';
import ChatTranscriptList from './ChatTranscriptList';
import { s } from './styles';
import { useChatDetailAgentTurn } from './useChatDetailAgentTurn';
import { useChatDetailHistory } from './useChatDetailHistory';
import { useChatDetailTranscriptScroll } from './useChatDetailTranscriptScroll';
import { usePendingImageUploads } from './usePendingImageUploads';

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
  const [composerSheetVisible, setComposerSheetVisible] = useState(false);
  const [composerSheetMode, setComposerSheetMode] = useState<ComposerSheetMode>('actions');
  const imageMapRef = useRef<Map<string, string>>(new Map());
  const listRef = useRef<FlatList<WsMessage>>(null);

  const endpoint = useEndpointStore((s) => s.endpoints.find((e) => e.id === endpoint_id));
  const conversations = useChatStore((s) => s.conversations);
  const messagesMap = useChatStore((s) => s.messages);
  const addConversation = useChatStore((s) => s.addConversation);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const messages = messagesMap[conv_id] ?? EMPTY_MESSAGES;
  const conversation = conversations.find((c) => c.id === conv_id);
  const { pendingImages, pickImage, removePendingImage, clearPendingImages } =
    usePendingImageUploads({ endpoint, endpoint_id, imageMapRef });
  const inboxMirrorStableKey = `${conversation?.agent_id ?? agent_id ?? ''}:${conversation?.agent_name ?? agent_name ?? ''}`;
  const navTitle = conversation?.agent_name ?? agent_name ?? conversation?.title ?? 'CHAT';

  const lastSeenAgentActivitySeqRef = useRef(getLatestAgentActivitySeq(messages));
  const lastAnimatedAgentTextSeqRef = useRef(getLatestAgentTextSeq(messages));

  const {
    catchUpAfterSeq,
    transcriptMessages,
    isLoadingOlder,
    hasUserScrolledHistoryRef,
    hasLoadedInitialMessagesRef,
    loadOlderMessages,
  } = useChatDetailHistory({
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
  });

  const conversationStatus = conversation?.status ?? 'idle';
  const {
    isAwaitingResponse,
    incomingAgentActivitySeq,
    activeTypewriterSeq,
    shouldForceComplete,
    isAgentRunning,
    handleSend,
    handleStop,
  } = useChatDetailAgentTurn({
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
  });

  const {
    handleTranscriptScroll,
    handleTranscriptScrollBeginDrag,
    handleContentSizeChange,
    handleScrollToIndexFailed,
  } = useChatDetailTranscriptScroll({
    listRef,
    focus_ask_id,
    transcriptMessages,
    isAgentRunning,
    hasUserScrolledHistoryRef,
    loadOlderMessages,
  });

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

  const handleInputChange = (text: string) => {
    setInput(text);
    if (text.startsWith('/')) {
      setComposerSheetMode('commands');
      setComposerSheetVisible(true);
    } else if (composerSheetVisible) {
      setComposerSheetVisible(false);
    }
  };

  const handleCommandSelect = (command: string) => {
    setInput(command + ' ');
    setComposerSheetVisible(false);
  };

  const onSend = () => {
    const text = input.trim();
    const hasUploadedImages = pendingImages.some((img) => img.status === 'uploaded' && img.fileId);
    if ((!text && !hasUploadedImages) || !endpoint) return;
    setInput('');
    void handleSend(text);
  };

  const isOffline = !endpoint || status === 'closed';
  const composerDisabled = isOffline || isAgentRunning;
  const modelSelector = useChatModelSelector({
    endpoint,
    endpointId: endpoint_id,
    convId: conv_id,
    agentId: agent_id,
    agentName: agent_name,
    conversation,
    isAwaitingResponse,
    addConversation,
    updateConversation,
  });
  const badge = isOffline
    ? { label: 'OFFLINE', bg: brandRgba.white88, dot: brandColors.error }
    : (STATUS_BADGE[conversation?.status ?? 'idle'] ?? STATUS_BADGE.idle);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ChatHeader title={navTitle} badge={badge} onBack={() => router.back()} />
        <ModelSelector
          visible={modelSelector.visible}
          models={modelSelector.runtimeModels}
          currentModelId={conversation?.model_id ?? null}
          disabled={modelSelector.modelSwitchDisabled}
          onClose={() => modelSelector.setVisible(false)}
          onSelect={(id) => void modelSelector.select(id)}
        />

        <ChatTranscriptList
          listRef={listRef}
          messages={transcriptMessages}
          isLoadingOlder={isLoadingOlder}
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
          onScrollBeginDrag={handleTranscriptScrollBeginDrag}
          onContentSizeChange={handleContentSizeChange}
          onScrollToIndexFailed={handleScrollToIndexFailed}
        />

        <CommandPopup
          visible={composerSheetVisible}
          mode={composerSheetMode}
          onModeChange={setComposerSheetMode}
          onPickImage={() => {
            setComposerSheetVisible(false);
            void pickImage();
          }}
          onSelect={handleCommandSelect}
          onDismiss={() => setComposerSheetVisible(false)}
        />
        <View style={s.inputArea}>
          <ChatInputBar
            value={input}
            onChangeText={handleInputChange}
            onSend={onSend}
            disabled={composerDisabled}
            isAgentRunning={isAgentRunning}
            onStop={handleStop}
            placeholder={isOffline ? 'Agent offline...' : 'Message...'}
            pendingImages={pendingImages}
            onRemoveImage={removePendingImage}
            modelLabel={modelSelector.currentModelLabel}
            modelDisabled={modelSelector.modelHeaderDisabled}
            onOpenModelSelector={modelSelector.open}
            onOpenComposerSheet={() => {
              setComposerSheetMode('actions');
              setComposerSheetVisible(true);
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

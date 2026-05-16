import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChatInputBar from '@/features/chat/components/ChatInputBar';
import CommandPopup from '@/features/chat/components/CommandPopup';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import {
  postMessage,
  fetchMessages,
  uploadImage,
  abortConversation,
  resolveUserMessageImageUri,
} from '@/features/chat/services/chatService';
import {
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
} from '@/features/chat/utils/chatRenderState';
import { loadAnsweredAsks } from '@/features/inbox/services/inboxService';
import { mirrorAskQuestionsToInbox } from '@/features/inbox/utils/mirrorAskQuestionsToInbox';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { useInboxStore } from '@/store/inboxStore';
import { type WsMessage } from '@/types';
import { s } from './styles';

// Stable fallback — never recreated, so Zustand won't see a changed snapshot
const EMPTY: WsMessage[] = [];
const WAITING_MESSAGE: WsMessage = {
  type: 'message',
  seq: -1,
  role: 'agent_text',
  payload: { text: '' },
  created_at: 0,
};

const STATUS_BADGE: Record<string, { label: string; bg: string; dot: string }> = {
  running: { label: 'RUNNING', bg: '#1A1A1A', dot: '#FF6B35' },
  awaiting_question: { label: 'AWAITING', bg: '#1A1A1A', dot: '#FF6B35' },
  completed: { label: 'COMPLETED', bg: '#1A1A1A', dot: '#4CAF50' },
  failed: { label: 'FAILED', bg: '#1A1A1A', dot: '#FF4444' },
  idle: { label: 'IDLE', bg: '#1A1A1A', dot: '#555555' },
};

interface PendingImage {
  localUri: string;
  fileId: string | null;
  status: 'uploading' | 'uploaded' | 'failed';
}

export default function ChatDetailScreen() {
  const {
    id: conv_id,
    endpoint_id,
    agent_id,
    agent_name,
  } = useLocalSearchParams<{
    id: string;
    endpoint_id: string;
    agent_id?: string;
    agent_name?: string;
  }>();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [typewriterSeq, setTypewriterSeq] = useState<number | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [commandPopupVisible, setCommandPopupVisible] = useState(false);
  const imageMapRef = useRef<Map<string, string>>(new Map());
  const scrollRef = useRef<ScrollView>(null);
  const prevMessageCountRef = useRef(0);

  const endpoint = useEndpointStore((s) => s.endpoints.find((e) => e.id === endpoint_id));
  const conversations = useChatStore((s) => s.conversations);
  // Select the whole map so the selector returns a stable object reference;
  // derive the per-conversation array outside the selector using the module-level EMPTY fallback.
  const messagesMap = useChatStore((s) => s.messages);
  const messages = messagesMap[conv_id] ?? EMPTY;
  const setMessages = useChatStore((s) => s.setMessages);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const addInboxItem = useInboxStore((s) => s.addItem);
  const conversation = conversations.find((c) => c.id === conv_id);
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
  // Memoize the imageUri callback so MessageBubble memo can bail out reliably
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
    // imageMapRef.current mutates in place — we intentionally omit it; the
    // function reference is stable, and Map lookups are always up-to-date.

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
        }
      : { base_url: '', token: '', conv_id, endpoint_id: '', agent_id: '', agent_name: '' },
  );

  useEffect(() => {
    if (!endpoint) return;
    Promise.all([
      fetchMessages(endpoint.base_url, endpoint.token, conv_id),
      loadAnsweredAsks(conv_id),
    ])
      .then(([msgs, answeredMap]) => {
        lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(msgs);
        lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(msgs);
        hasLoadedInitialMessagesRef.current = true;
        const merged = msgs.map((m) => {
          if (m.role !== 'ask_question') return m;
          const ask_id = (m.payload as { ask_id?: string }).ask_id ?? '';
          const record = answeredMap.get(ask_id);
          if (!record) return m;
          return {
            ...m,
            answered: true,
            answeredChoiceId: record.choice_id,
            answeredChoiceIds: record.choice_ids,
          };
        });
        setMessages(conv_id, merged);
        void mirrorAskQuestionsToInbox({
          messages: merged,
          endpoint_id: endpoint_id ?? '',
          agent_id: conversation?.agent_id ?? agent_id ?? '',
          agent_name: conversation?.agent_name ?? agent_name,
          conversation_id: conv_id,
          addItem: addInboxItem,
        });
      })
      .catch(() => {
        hasLoadedInitialMessagesRef.current = true;
      });
  }, [
    conv_id,
    endpoint,
    endpoint_id,
    agent_id,
    agent_name,
    conversation,
    setMessages,
    addInboxItem,
  ]);

  async function pickImage() {
    if (pendingImages.length >= 5) {
      Alert.alert('最多选择 5 张图片');
      return;
    }

    const doLaunch = async (launcher: () => Promise<ImagePicker.ImagePickerResult>) => {
      const result = await launcher();
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const compressed = await ImageManipulator.manipulateAsync(asset.uri, [], {
        compress: 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const localUri = compressed.uri;
      setPendingImages((prev) => [...prev, { localUri, fileId: null, status: 'uploading' }]);
      if (!endpoint) return;
      try {
        const res = await uploadImage(endpoint.base_url, endpoint.token, localUri);
        imageMapRef.current.set(res.file_id, localUri);
        setPendingImages((prev) =>
          prev.map((img) =>
            img.localUri === localUri && img.status === 'uploading'
              ? { ...img, fileId: res.file_id, status: 'uploaded' }
              : img,
          ),
        );
      } catch {
        setPendingImages((prev) =>
          prev.map((img) =>
            img.localUri === localUri && img.status === 'uploading'
              ? { ...img, status: 'failed' }
              : img,
          ),
        );
      }
    };

    const requestAndLaunch = async (
      permFn: () => Promise<ImagePicker.PermissionResponse>,
      launcher: () => Promise<ImagePicker.ImagePickerResult>,
    ) => {
      const { status: permStatus } = await permFn();
      if (permStatus !== 'granted') {
        Alert.alert('需要权限', '请在设置中开启相册/相机权限', [
          { text: '取消', style: 'cancel' },
          {
            text: '去设置',
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ]);
        return;
      }
      await doLaunch(launcher);
    };

    await requestAndLaunch(ImagePicker.requestMediaLibraryPermissionsAsync, () =>
      ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }),
    );
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
    setPendingImages([]);
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
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setIsAwaitingResponse(false);
    }
  };

  const isOffline = !endpoint || status === 'closed';
  // Agent is "running" if we are waiting for the first response (optimistic) OR
  // if the server has explicitly set the conversation status to 'running'.
  // Using conversation.status as the authoritative source prevents the race
  // where isAwaitingResponse was reset as soon as the first agent message
  // arrived, causing the stop button to disappear mid-run.
  const conversationStatus = conversation?.status ?? 'idle';
  // Synchronously-computed forceComplete flag — avoids setState async race.
  // true when: last message is a tool_call (AI text phase ended), or task completed/failed.
  // Intentionally excludes 'idle' (initial state) to avoid mis-killing typewriter on page load.
  const lastMsg = messages.at(-1);
  const shouldForceComplete =
    lastMsg?.role === 'tool_call' ||
    conversationStatus === 'completed' ||
    conversationStatus === 'failed';
  const isAgentRunning = isAwaitingResponse || conversationStatus === 'running';
  const composerDisabled = isOffline || isAgentRunning;

  useEffect(() => {
    if (isAwaitingResponse && latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current) {
      // First agent activity arrived — the optimistic "awaiting" phase is over.
      // We can clear the local flag; visibility of the stop button is now
      // driven by conversation.status (set by the WebSocket hook).
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

  // Sync local isAwaitingResponse with conversation.status.
  // If the server reports the conversation is no longer running (idle/completed/failed),
  // clear the local optimistic flag so the stop button disappears correctly.
  // Guard: only clear when the conversation actually exists in the store.
  // If it doesn't exist yet (e.g. navigation from agent screen before the store
  // is seeded), updateConversation('running') is a no-op and conversationStatus
  // stays 'idle' — without the guard that would immediately cancel the optimistic
  // waiting state and the Analyzing… bubble would never appear.
  useEffect(() => {
    if (isAwaitingResponse && conversation && conversationStatus !== 'running') {
      setIsAwaitingResponse(false);
    }
  }, [conversationStatus, isAwaitingResponse, conversation]);

  const badge = isOffline
    ? { label: 'OFFLINE', bg: '#1A1A1A', dot: '#FF4444' }
    : (STATUS_BADGE[conversation?.status ?? 'idle'] ?? STATUS_BADGE.idle);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.nav}>
          <TouchableOpacity onPress={() => router.back()}>
            <ChevronLeft size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.navTitle}>{navTitle}</Text>
          <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
            <View style={[s.statusDot, { backgroundColor: badge.dot }]} />
            <Text testID="status-badge-text" style={s.statusBadgeText}>
              {badge.label}
            </Text>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          onContentSizeChange={(_w, _h) => {
            // Only auto-scroll when a new message is appended (count increases).
            // Avoids triggering on every streaming text update while a message
            // is already visible, which causes janky re-layout on long histories.
            const currentCount = messages.length + (isAgentRunning ? 1 : 0);
            if (currentCount > prevMessageCountRef.current) {
              prevMessageCountRef.current = currentCount;
              scrollRef.current?.scrollToEnd({ animated: true });
            }
          }}
        >
          {messages.map((msg) => (
            <MessageBubble
              key={`${msg.seq}`}
              msg={msg}
              typewriter={msg.seq === activeTypewriterSeq}
              forceComplete={msg.seq === activeTypewriterSeq && shouldForceComplete}
              onAnswer={sendAnswer}
              onAnswerMulti={sendAnswerMulti}
              imageUri={imageUriForMessage(msg)}
              waiting={false}
              serverUrl={endpoint?.base_url ?? ''}
              token={endpoint?.token ?? ''}
            />
          ))}
          {isAgentRunning && incomingAgentActivitySeq === null && (
            <MessageBubble msg={WAITING_MESSAGE} waiting />
          )}
        </ScrollView>

        <CommandPopup
          visible={commandPopupVisible}
          onSelect={handleCommandSelect}
          onDismiss={() => setCommandPopupVisible(false)}
        />
        <View style={s.inputArea}>
          {pendingImages.length > 0 && (
            <ScrollView
              testID="img-preview-row"
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.previewRow}
              contentContainerStyle={s.previewRowContent}
            >
              {pendingImages.map((img, idx) => (
                <View key={img.localUri} style={s.thumbWrapper}>
                  <Image source={{ uri: img.localUri }} style={s.thumb} />
                  {img.status === 'uploading' && (
                    <View style={s.thumbOverlay}>
                      <Text style={s.thumbOverlayText}>...</Text>
                    </View>
                  )}
                  {img.status === 'failed' && (
                    <View style={[s.thumbOverlay, s.thumbFailed]}>
                      <Text style={s.thumbOverlayText}>!</Text>
                    </View>
                  )}
                  <Pressable
                    testID={`remove-img-${idx}`}
                    style={s.removeBadge}
                    onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <X size={8} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
          <ChatInputBar
            value={input}
            onChangeText={handleInputChange}
            onSend={() => {
              void handleSend();
            }}
            onPickImage={() => {
              void pickImage();
            }}
            onOpenCommands={() => setCommandPopupVisible(true)}
            disabled={composerDisabled}
            isAgentRunning={isAgentRunning}
            onStop={() => {
              if (endpoint) {
                void abortConversation(endpoint.base_url, endpoint.token, conv_id)
                  .then(() => {
                    setIsAwaitingResponse(false);
                  })
                  .catch((e: unknown) => {
                    console.warn('abort failed', e);
                  });
              } else {
                console.warn('abort: no endpoint available');
              }
            }}
            placeholder={isOffline ? 'Agent offline...' : 'Message...'}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

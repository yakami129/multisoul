import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ImageIcon, Send, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MessageBubble } from '../../../src/features/chat/components/MessageBubble';
import {
  createConversation,
  fetchMessages,
  postMessage,
  uploadImage,
} from '../../../src/features/chat/services/chatService';
import {
  getLatestAgentActivitySeq,
  getLatestAgentTextSeq,
} from '../../../src/features/chat/utils/chatRenderState';
import { mirrorAskQuestionsToInbox } from '../../../src/features/inbox/utils/mirrorAskQuestionsToInbox';
import { useWebSocket } from '../../../src/hooks/useWebSocket';
import { useChatStore } from '../../../src/store/chatStore';
import { useEndpointStore } from '../../../src/store/endpointStore';
import { useInboxStore } from '../../../src/store/inboxStore';
import { type WsMessage, type TaskStatusPayload, type UserTextPayload } from '../../../src/types';

// Stable fallback — never recreated, so Zustand won't see a changed snapshot (Bug 1 fix)
const EMPTY: WsMessage[] = [];
const WAITING_MESSAGE: WsMessage = {
  type: 'message',
  seq: -1,
  role: 'agent_text',
  payload: { text: '' },
  created_at: 0,
};

export default function AgentChatRoute() {
  const {
    id: agent_id,
    endpoint_id,
    agent_name,
    conv_id: initialConvId,
  } = useLocalSearchParams<{
    id: string;
    endpoint_id: string;
    agent_name?: string;
    conv_id?: string;
  }>();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [typewriterSeq, setTypewriterSeq] = useState<number | null>(null);
  // If navigated from a notification, initialConvId is already set — use it directly
  // instead of creating a new conversation.
  const [convId, setConvId] = useState<string | null>(initialConvId ?? null);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const imageMapRef = useRef<Map<string, string>>(new Map());
  const [isUploading, setIsUploading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const endpoint = useEndpointStore((s) => s.endpoints.find((e) => e.id === endpoint_id));
  // Bug 1 fix: select the whole map so the selector returns a stable object reference;
  // derive the per-conversation array outside the selector using the module-level EMPTY fallback.
  const messagesMap = useChatStore((s) => s.messages);
  const messages = messagesMap[convId ?? ''] ?? EMPTY;
  const setMessages = useChatStore((s) => s.setMessages);
  const addInboxItem = useInboxStore((s) => s.addItem);

  // For each task_id, only show the latest task_status message — hides redundant RUNNING rows
  const displayMessages = useMemo(() => {
    const latestSeq = new Map<string, number>();
    messages.forEach((msg) => {
      if (msg.role === 'task_status') {
        const p = msg.payload as TaskStatusPayload;
        if (msg.seq > (latestSeq.get(p.task_id) ?? -1)) latestSeq.set(p.task_id, msg.seq);
      }
    });
    return messages.filter((msg) => {
      if (msg.role !== 'task_status') return true;
      const p = msg.payload as TaskStatusPayload;
      return latestSeq.get(p.task_id) === msg.seq;
    });
  }, [messages]);
  const latestAgentActivitySeq = getLatestAgentActivitySeq(displayMessages);
  const latestAgentSeq = getLatestAgentTextSeq(displayMessages);
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
  const imageUriForMessage = (msg: WsMessage) => {
    if (msg.role !== 'user_text') return undefined;
    const fileId = (msg.payload as UserTextPayload).file_id;
    return fileId ? imageMapRef.current.get(fileId) : undefined;
  };

  const { status, sendAnswer, sendAnswerMulti } = useWebSocket(
    endpoint && convId
      ? {
          base_url: endpoint.base_url,
          token: endpoint.token,
          conv_id: convId,
          endpoint_id: endpoint_id ?? '',
          agent_id: agent_id ?? '',
          agent_name,
        }
      : { base_url: '', token: '', conv_id: '', endpoint_id: '', agent_id: '', agent_name: '' },
  );

  // If navigated from a notification, load the existing conversation's messages.
  // Otherwise create a new conversation.
  useEffect(() => {
    if (!endpoint || !agent_id) return;

    if (initialConvId) {
      // Notification deep-link: load existing conversation, don't create a new one
      fetchMessages(endpoint.base_url, endpoint.token, initialConvId)
        .then((msgs) => {
          lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(msgs);
          lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(msgs);
          hasLoadedInitialMessagesRef.current = true;
          setMessages(initialConvId, msgs);
          void mirrorAskQuestionsToInbox({
            messages: msgs,
            endpoint_id: endpoint_id ?? '',
            agent_id: agent_id ?? '',
            agent_name,
            conversation_id: initialConvId,
            addItem: addInboxItem,
          });
        })
        .catch(() => {
          hasLoadedInitialMessagesRef.current = true;
        });
      return;
    }

    // Normal entry: create a new conversation
    // Bug 3 fix: capture conv.id in a closure-local variable so the second .then()
    // doesn't read the stale convId state (which is still null at that point).
    let newConvId: string;
    createConversation(endpoint.base_url, endpoint.token, agent_id, 'New Chat')
      .then((conv) => {
        newConvId = conv.id;
        setConvId(conv.id);
        return fetchMessages(endpoint.base_url, endpoint.token, conv.id);
      })
      .then((msgs) => {
        lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(msgs);
        lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(msgs);
        hasLoadedInitialMessagesRef.current = true;
        setMessages(newConvId, msgs);
        void mirrorAskQuestionsToInbox({
          messages: msgs,
          endpoint_id: endpoint_id ?? '',
          agent_id: agent_id ?? '',
          agent_name,
          conversation_id: newConvId,
          addItem: addInboxItem,
        });
      })
      .catch(() => {
        hasLoadedInitialMessagesRef.current = true;
      });
  }, [endpoint, endpoint_id, agent_id, agent_name, initialConvId, setMessages, addInboxItem]);

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const compressed = await ImageManipulator.manipulateAsync(asset.uri, [], {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    setPendingImageUri(compressed.uri);
  }

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !pendingImageUri) || !endpoint || !convId) return;
    lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(displayMessages);
    lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(displayMessages);
    hasLoadedInitialMessagesRef.current = true;
    setInput('');
    setIsAwaitingResponse(true);
    setTypewriterSeq(null);

    let file_id: string | undefined;
    const capturedUri = pendingImageUri;
    setPendingImageUri(null);

    try {
      if (capturedUri) {
        setIsUploading(true);
        const result = await uploadImage(endpoint.base_url, endpoint.token, capturedUri);
        file_id = result.file_id;
        imageMapRef.current.set(file_id, capturedUri);
        setIsUploading(false);
      }
      await postMessage(endpoint.base_url, endpoint.token, convId, text, file_id);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setIsUploading(false);
      setIsAwaitingResponse(false);
    }
  };

  const isOffline = !endpoint || !convId || status === 'closed';
  const composerDisabled = isOffline || isAwaitingResponse;

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

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.nav}>
          <TouchableOpacity onPress={() => router.back()}>
            <ChevronLeft size={24} color="#20C20E" />
          </TouchableOpacity>
          <Text style={s.navTitle}>{agent_name ?? 'CHAT'}</Text>
          <View style={[s.dot, { backgroundColor: status === 'open' ? '#33FF33' : '#2D8B2D' }]} />
        </View>

        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {displayMessages.map((msg) => (
            <MessageBubble
              key={`${msg.seq}`}
              msg={msg}
              typewriter={msg.seq === activeTypewriterSeq}
              onAnswer={sendAnswer}
              onAnswerMulti={sendAnswerMulti}
              imageUri={imageUriForMessage(msg)}
            />
          ))}
          {isAwaitingResponse && incomingAgentActivitySeq === null && (
            <MessageBubble msg={WAITING_MESSAGE} waiting />
          )}
        </ScrollView>

        {pendingImageUri ? (
          <View style={s.pendingImageWrap}>
            <Image source={{ uri: pendingImageUri }} style={s.pendingThumb} />
            <Pressable style={s.pendingRemove} onPress={() => setPendingImageUri(null)}>
              <X size={12} color="#040D04" />
            </Pressable>
          </View>
        ) : null}

        <View style={s.inputBar}>
          <TouchableOpacity
            accessibilityLabel="Attach image"
            accessibilityRole="button"
            testID="attach-image-button"
            onPress={() => {
              void pickImage();
            }}
            disabled={composerDisabled || isUploading}
            style={[s.imageBtn, (composerDisabled || isUploading) && s.imageBtnDisabled]}
          >
            <ImageIcon size={16} color={composerDisabled ? '#2D8B2D' : '#20C20E'} />
          </TouchableOpacity>
          <View style={[s.inputField, composerDisabled && s.inputDisabled]}>
            <TextInput
              style={s.input}
              placeholder={isOffline ? 'Connecting…' : 'Message…'}
              placeholderTextColor="#2D8B2D"
              value={input}
              onChangeText={setInput}
              editable={!composerDisabled}
              multiline
              textAlignVertical="top"
            />
          </View>
          <TouchableOpacity
            onPress={() => {
              void handleSend();
            }}
            disabled={composerDisabled}
          >
            {isAwaitingResponse ? (
              <Text style={s.waitText}>WAIT</Text>
            ) : (
              <Send size={20} color={composerDisabled ? '#2D8B2D' : '#20C20E'} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
  nav: {
    height: 52,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  navTitle: { fontFamily: 'Anton', fontSize: 16, color: '#20C20E' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  inputBar: {
    minHeight: 60,
    maxHeight: 160,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#0F2B0F',
  },
  inputField: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    backgroundColor: '#0A1A0A',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  inputDisabled: { opacity: 0.4 },
  input: { fontFamily: 'Geist', fontSize: 14, color: '#20C20E', minHeight: 20 },
  waitText: { fontFamily: 'Geist Mono', fontSize: 10, color: '#33FF33', letterSpacing: 1 },
  pendingImageWrap: {
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  pendingThumb: {
    width: 60,
    height: 60,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  pendingRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#20C20E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBtn: {
    width: 36,
    height: 36,
    backgroundColor: '#0A1A0A',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBtnDisabled: { opacity: 0.5 },
});

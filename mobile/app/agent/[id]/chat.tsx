import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { ChevronLeft, Send } from 'lucide-react-native';
import { WsMessage, TaskStatusPayload } from '../../../src/types';
import { useChatStore } from '../../../src/store/chatStore';
import { useEndpointStore } from '../../../src/store/endpointStore';
import { useWebSocket } from '../../../src/hooks/useWebSocket';
import { MessageBubble } from '../../../src/features/chat/components/MessageBubble';
import { createConversation, fetchMessages, postMessage } from '../../../src/features/chat/services/chatService';
import { getLatestAgentActivitySeq, getLatestAgentTextSeq } from '../../../src/features/chat/utils/chatRenderState';

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
  const { id: agent_id, endpoint_id, agent_name } = useLocalSearchParams<{ id: string; endpoint_id: string; agent_name?: string }>();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [typewriterSeq, setTypewriterSeq] = useState<number | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const endpoint = useEndpointStore((s) => s.endpoints.find((e) => e.id === endpoint_id));
  // Bug 1 fix: select the whole map so the selector returns a stable object reference;
  // derive the per-conversation array outside the selector using the module-level EMPTY fallback.
  const messagesMap = useChatStore((s) => s.messages);
  const messages = messagesMap[convId ?? ''] ?? EMPTY;
  const setMessages = useChatStore((s) => s.setMessages);

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
  const incomingAgentActivitySeq = isAwaitingResponse && latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current
    ? latestAgentActivitySeq
    : null;
  const incomingAgentTextSeq = latestAgentSeq > lastAnimatedAgentTextSeqRef.current
    ? latestAgentSeq
    : null;
  const activeTypewriterSeq = incomingAgentTextSeq ?? typewriterSeq;

  const { status, sendAnswer, sendAnswerMulti } = useWebSocket(
    endpoint && convId
      ? { base_url: endpoint.base_url, token: endpoint.token, conv_id: convId, endpoint_id: endpoint_id ?? '', agent_id: agent_id ?? '', agent_name }
      : { base_url: '', token: '', conv_id: '', endpoint_id: '', agent_id: '', agent_name: '' }
  );






  // Create a new conversation on mount
  useEffect(() => {
    if (!endpoint || !agent_id) return;
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
        setMessages(newConvId, msgs);
      })
      .catch(() => {});
  }, [endpoint, agent_id]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !endpoint || !convId) return;
    lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(displayMessages);
    lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(displayMessages);
    setInput('');
    setIsAwaitingResponse(true);
    setTypewriterSeq(null);
    try {
      await postMessage(endpoint.base_url, endpoint.token, convId, text);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setIsAwaitingResponse(false);
    }
  };

  const isOffline = !endpoint || !convId || status === 'closed';
  const composerDisabled = isOffline || isAwaitingResponse;

  useEffect(() => {
    if (isAwaitingResponse && latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current) {
      setIsAwaitingResponse(false);
      lastSeenAgentActivitySeqRef.current = latestAgentActivitySeq;
    } else if (!isAwaitingResponse && latestAgentActivitySeq > lastSeenAgentActivitySeqRef.current) {
      lastSeenAgentActivitySeqRef.current = latestAgentActivitySeq;
    }

    if (latestAgentSeq > lastAnimatedAgentTextSeqRef.current) {
      setTypewriterSeq(latestAgentSeq);
      lastAnimatedAgentTextSeqRef.current = latestAgentSeq;
    }
  }, [isAwaitingResponse, latestAgentActivitySeq, latestAgentSeq]);

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.nav}>
          <TouchableOpacity onPress={() => router.back()}>
            <ChevronLeft size={24} color="#20C20E" />
          </TouchableOpacity>
          <Text style={s.navTitle}>CHAT</Text>
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
            />
          ))}
          {isAwaitingResponse && incomingAgentActivitySeq === null && (
            <MessageBubble msg={WAITING_MESSAGE} waiting />
          )}
        </ScrollView>

        <View style={s.inputBar}>
          <View style={[s.inputField, composerDisabled && s.inputDisabled]}>
            <TextInput
              style={s.input}
              placeholder={isOffline ? 'Connecting…' : 'Message…'}
              placeholderTextColor="#2D8B2D"
              value={input}
              onChangeText={setInput}
              editable={!composerDisabled}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
          </View>
          <TouchableOpacity onPress={handleSend} disabled={composerDisabled}>
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
  safe:          { flex: 1, backgroundColor: '#040D04' },
  nav:           { height: 52, backgroundColor: '#061206', flexDirection: 'row',
                   alignItems: 'center', justifyContent: 'space-between',
                   paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  navTitle:      { fontFamily: 'Anton', fontSize: 16, color: '#20C20E' },
  dot:           { width: 8, height: 8, borderRadius: 4 },
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  inputBar:      { height: 60, backgroundColor: '#061206', flexDirection: 'row',
                   alignItems: 'center', paddingHorizontal: 12, gap: 8,
                   borderTopWidth: 1, borderTopColor: '#0F2B0F' },
  inputField:    { flex: 1, height: 36, backgroundColor: '#0A1A0A', borderRadius: 2,
                   borderWidth: 1, borderColor: '#0F2B0F', paddingHorizontal: 14,
                   justifyContent: 'center' },
  inputDisabled: { opacity: 0.4 },
  input:         { fontFamily: 'Geist', fontSize: 14, color: '#20C20E' },
  waitText:      { fontFamily: 'Geist Mono', fontSize: 10, color: '#33FF33', letterSpacing: 1 },
});

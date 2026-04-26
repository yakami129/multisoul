import React, { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  SafeAreaView, StyleSheet, ScrollView, View, Text,
  TextInput, TouchableOpacity, KeyboardAvoidingView, Platform,
} from 'react-native';
import { ChevronLeft, Send } from 'lucide-react-native';
import { WsMessage } from '@/types';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import { postMessage, fetchMessages } from '@/features/chat/services/chatService';

// Stable fallback — never recreated, so Zustand won't see a changed snapshot
const EMPTY: WsMessage[] = [];

export default function ChatDetailScreen() {
  const { id: conv_id, endpoint_id } = useLocalSearchParams<{ id: string; endpoint_id: string }>();
  const router = useRouter();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const endpoint = useEndpointStore((s) => s.endpoints.find((e) => e.id === endpoint_id));
  // Select the whole map so the selector returns a stable object reference;
  // derive the per-conversation array outside the selector using the module-level EMPTY fallback.
  const messagesMap = useChatStore((s) => s.messages);
  const messages = messagesMap[conv_id] ?? EMPTY;
  const setMessages = useChatStore((s) => s.setMessages);

  const { status, sendAnswer } = useWebSocket(
    endpoint
      ? { base_url: endpoint.base_url, token: endpoint.token, conv_id }
      : { base_url: '', token: '', conv_id }
  );

  useEffect(() => {
    if (!endpoint) return;
    fetchMessages(endpoint.base_url, endpoint.token, conv_id)
      .then((msgs) => setMessages(conv_id, msgs))
      .catch(() => {});
  }, [conv_id, endpoint]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !endpoint) return;
    setInput('');
    await postMessage(endpoint.base_url, endpoint.token, conv_id, text);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const isOffline = !endpoint || status === 'closed';

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
          {messages.map((msg) => (
            <MessageBubble key={`${msg.seq}`} msg={msg} onAnswer={sendAnswer} />
          ))}
        </ScrollView>

        <View style={s.inputBar}>
          <View style={[s.inputField, isOffline && s.inputDisabled]}>
            <TextInput
              style={s.input}
              placeholder={isOffline ? 'Agent offline...' : 'Message...'}
              placeholderTextColor="#2D8B2D"
              value={input}
              onChangeText={setInput}
              editable={!isOffline}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
          </View>
          <TouchableOpacity onPress={handleSend} disabled={isOffline}>
            <Send size={20} color={isOffline ? '#2D8B2D' : '#20C20E'} />
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
});

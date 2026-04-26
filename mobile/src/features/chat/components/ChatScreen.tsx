import { ArrowLeft, Send } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatMessage, ChatStatus } from '../hooks/useChatSocket';

const TYPEWRITER_INTERVAL_MS = 28;
const WAITING_MESSAGE_ID = '__chat_waiting_for_assistant__';

type RenderMessage = ChatMessage | (ChatMessage & { waiting: true });

function getLatestAssistantMessage(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return messages[index];
    }
  }
  return null;
}

interface Props {
  agentName: string;
  messages: ChatMessage[];
  status: ChatStatus;
  onSend: (text: string) => void;
  onBack: () => void;
}

export function ChatScreen({ agentName, messages, status, onSend, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [typewriterMessageId, setTypewriterMessageId] = useState<string | null>(null);
  const [visibleTypewriterChars, setVisibleTypewriterChars] = useState(0);
  const listRef = useRef<FlatList>(null);
  const latestAssistant = getLatestAssistantMessage(messages);
  const lastSeenAssistantIdRef = useRef<string | null>(latestAssistant?.id ?? null);
  const incomingAssistantId = isAwaitingResponse
    && latestAssistant
    && latestAssistant.id !== lastSeenAssistantIdRef.current
    ? latestAssistant.id
    : null;
  const activeTypewriterId = incomingAssistantId ?? typewriterMessageId;
  const composerDisabled = status !== 'connected' || isAwaitingResponse;
  const showWaitingBubble = isAwaitingResponse && !incomingAssistantId;
  const renderMessages: RenderMessage[] = showWaitingBubble
    ? [
        ...messages,
        {
          id: WAITING_MESSAGE_ID,
          role: 'assistant',
          text: 'awaiting encrypted response',
          createdAt: new Date(0).toISOString(),
          streaming: true,
          waiting: true,
        },
      ]
    : messages;

  function handleSend() {
    const text = input.trim();
    if (!text || composerDisabled) return;
    lastSeenAssistantIdRef.current = latestAssistant?.id ?? null;
    setInput('');
    setIsAwaitingResponse(true);
    setTypewriterMessageId(null);
    setVisibleTypewriterChars(0);
    onSend(text);
  }

  useEffect(() => {
    if (!latestAssistant) return;

    if (isAwaitingResponse && latestAssistant.id !== lastSeenAssistantIdRef.current) {
      setIsAwaitingResponse(false);
      setTypewriterMessageId(latestAssistant.id);
      setVisibleTypewriterChars(0);
      lastSeenAssistantIdRef.current = latestAssistant.id;
      return;
    }

    if (!isAwaitingResponse && latestAssistant.id !== typewriterMessageId) {
      lastSeenAssistantIdRef.current = latestAssistant.id;
    }
  }, [isAwaitingResponse, latestAssistant, typewriterMessageId]);

  useEffect(() => {
    if (!typewriterMessageId) return undefined;
    const message = messages.find((item) => item.id === typewriterMessageId);
    if (!message) return undefined;

    const timer = setInterval(() => {
      setVisibleTypewriterChars((count) => {
        if (count >= message.text.length) {
          clearInterval(timer);
          return count;
        }
        return Math.min(count + 1, message.text.length);
      });
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [messages, typewriterMessageId]);

  function getDisplayText(item: RenderMessage) {
    if ('waiting' in item) {
      return `${item.text}▋`;
    }

    if (item.id !== activeTypewriterId) {
      return `${item.text}${item.streaming ? '▋' : ''}`;
    }

    const visibleText = item.text.slice(0, visibleTypewriterChars);
    const isRevealing = visibleTypewriterChars < item.text.length;
    return `${visibleText}${isRevealing || item.streaming ? '▋' : ''}`;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#040D04', paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: '#0F2B0F',
        backgroundColor: '#061206',
      }}>
        <Pressable onPress={onBack} style={{ marginRight: 12 }}>
          <ArrowLeft size={16} color="#20C20E" />
        </Pressable>
        <Text style={{ flex: 1, color: '#20C20E', fontFamily: 'Anton', fontSize: 14 }}>
          {agentName}
        </Text>
        <View style={{
          width: 6, height: 6, borderRadius: 1,
          backgroundColor: status === 'connected' ? '#33FF33' : '#2D8B2D',
        }} />
      </View>

      {/* Reconnecting banner */}
      {status === 'reconnecting' && (
        <View style={{ backgroundColor: '#061206', paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' }}>
          <Text style={{ color: '#2D8B2D', fontSize: 11, textAlign: 'center', fontFamily: 'Inter' }}>
            Reconnecting…
          </Text>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={renderMessages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isUser = item.role === 'user';
          const isWaiting = 'waiting' in item;
          return (
            <View style={{
              marginBottom: 16,
              maxWidth: '80%',
              alignSelf: isUser ? 'flex-end' : 'flex-start',
            }}>
              <Text style={{
                fontSize: 9,
                fontFamily: 'Inter',
                letterSpacing: 1.5,
                color: '#0F6B0F',
                marginBottom: 4,
                textAlign: isUser ? 'right' : 'left',
              }}>
                {isUser ? 'YOU' : 'VAULT-TEC AI'}
              </Text>
              {isWaiting && (
                <Text style={{
                  marginBottom: 4,
                  color: '#33FF33',
                  fontFamily: 'Geist Mono',
                  fontSize: 9,
                  letterSpacing: 1.8,
                }}>
                  ACCESSING NEURAL LINK
                </Text>
              )}
              <View style={{
                borderTopLeftRadius: isUser ? 12 : 2,
                borderTopRightRadius: isUser ? 2 : 12,
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
                paddingHorizontal: 12, paddingVertical: 8,
                backgroundColor: isUser ? '#20C20E' : '#061206',
                borderWidth: isUser ? 0 : 1,
                borderColor: isWaiting ? '#33FF33' : '#0F2B0F',
                borderStyle: isWaiting ? 'dashed' : 'solid',
              }}>
                <Text style={{
                  fontSize: 15, fontFamily: 'Geist',
                  color: isUser ? '#040D04' : (isWaiting ? '#7CFF6B' : '#20C20E'),
                }}>
                  {getDisplayText(item)}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {/* Input */}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end',
        paddingHorizontal: 16, paddingTop: 12,
        paddingBottom: insets.bottom + 12,
        borderTopWidth: 1, borderTopColor: '#0F2B0F',
        backgroundColor: '#061206',
      }}>
        <TextInput
          style={{
            flex: 1, backgroundColor: '#0A1A0A',
            borderWidth: 1, borderColor: '#0F2B0F', borderRadius: 2,
            paddingHorizontal: 12, paddingVertical: 8,
            fontSize: 16, fontFamily: 'Geist Mono',
            color: '#20C20E', marginRight: 8, minHeight: 40,
          }}
          placeholder="Message…"
          placeholderTextColor="#0F6B0F"
          value={input}
          onChangeText={setInput}
          editable={!composerDisabled}
          multiline
          onSubmitEditing={handleSend}
        />
        <Pressable
          testID="send-button"
          onPress={handleSend}
          disabled={!input.trim() || composerDisabled}
          style={{
            width: 40, height: 40, borderRadius: 2,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: input.trim() && !composerDisabled ? '#20C20E' : '#0A1A0A',
            borderWidth: 1, borderColor: isAwaitingResponse ? '#33FF33' : input.trim() && !composerDisabled ? '#20C20E' : '#0F2B0F',
          }}
        >
          {isAwaitingResponse ? (
            <Text style={{ color: '#33FF33', fontFamily: 'Geist Mono', fontSize: 9 }}>
              WAIT
            </Text>
          ) : (
            <Send size={16} color={input.trim() && !composerDisabled ? '#040D04' : '#0F6B0F'} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

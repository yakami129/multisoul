import { ArrowLeft, Send } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatMessage, ChatStatus } from '../hooks/useChatSocket';

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
  const listRef = useRef<FlatList>(null);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    onSend(text);
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
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={{
            marginBottom: 12,
            maxWidth: '80%',
            alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <View style={{
              borderRadius: 2,
              paddingHorizontal: 12, paddingVertical: 8,
              backgroundColor: item.role === 'user' ? '#0A1A0A' : '#061206',
              borderWidth: 1,
              borderColor: item.role === 'user' ? '#20C20E' : '#0F2B0F',
            }}>
              <Text style={{
                fontSize: 15, fontFamily: 'Geist',
                color: item.role === 'user' ? '#33FF33' : '#20C20E',
              }}>
                {item.text}{item.streaming ? '▋' : ''}
              </Text>
            </View>
          </View>
        )}
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
          multiline
          onSubmitEditing={handleSend}
        />
        <Pressable
          testID="send-button"
          onPress={handleSend}
          disabled={!input.trim()}
          style={{
            width: 40, height: 40, borderRadius: 2,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: input.trim() ? '#20C20E' : '#0A1A0A',
            borderWidth: 1, borderColor: input.trim() ? '#20C20E' : '#0F2B0F',
          }}
        >
          <Send size={16} color={input.trim() ? '#040D04' : '#0F6B0F'} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

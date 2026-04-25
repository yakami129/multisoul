import React, { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, StyleSheet } from 'react-native';
import NewChatScreen from '@/features/chat/components/NewChatScreen';
import {
  mockConversations,
  mockMessages,
  mockPendingQuestion,
} from '@/features/chat/services/chatMockData';
import { ChatMessage, PendingQuestion } from '@/features/chat/types';

export default function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const conversation = mockConversations.find((c) => c.id === id);
  const [messages, setMessages] = useState<ChatMessage[]>(
    mockMessages[id ?? ''] ?? []
  );
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(
    id === 'grok' ? mockPendingQuestion : null
  );

  const agentName = conversation?.agentName ?? id ?? 'Agent';

  const handleSend = (text: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const aiMsg: ChatMessage = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: `Processing: "${text}"... VAULT-TEC SYSTEMS ONLINE.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setTimeout(() => setMessages((prev) => [...prev, aiMsg]), 1500);
  };

  const handleAnswerQuestion = (_questionId: string, selectedOptionId: string) => {
    const option = pendingQuestion?.options.find((o) => o.id === selectedOptionId);
    const confirmMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: `Selected: ${option?.label ?? selectedOptionId}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const aiResponse: ChatMessage = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: `Confirmed. Proceeding with ${option?.label ?? selectedOptionId}...`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, confirmMsg]);
    setPendingQuestion(null);
    setTimeout(() => setMessages((prev) => [...prev, aiResponse]), 1000);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <NewChatScreen
        agentName={agentName}
        messages={messages}
        pendingQuestion={pendingQuestion}
        onBack={() => router.back()}
        onSend={handleSend}
        onAnswerQuestion={handleAnswerQuestion}
        onDismissQuestion={() => setPendingQuestion(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#040D04',
  },
});

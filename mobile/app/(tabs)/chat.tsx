import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import ChatHomeScreen from '@/features/chat/components/ChatHomeScreen';
import { mockConversations } from '@/features/chat/services/chatMockData';

export default function ChatTab() {
  const router = useRouter();
  const [conversations] = useState(mockConversations);

  return (
    <SafeAreaView style={s.safe}>
      <ChatHomeScreen
        conversations={conversations}
        onPressConversation={(id) => router.push(`/chat/${id}` as any)}
        onPressNewChat={() => {}}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#040D04',
  },
});

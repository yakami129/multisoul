import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useChatStore } from '@/store/chatStore';
import ChatHomeScreen from '@/features/chat/components/ChatHomeScreen';
import { Conversation } from '@/types';

export default function ChatTab() {
  const router = useRouter();
  const conversations = useChatStore((s) => s.conversations);

  const handlePress = (conv: Conversation) => {
    router.push(`/chat/${conv.id}?endpoint_id=${conv.endpoint_id}` as any);
  };

  return (
    <SafeAreaView style={s.safe}>
      <ChatHomeScreen
        conversations={conversations}
        onPressConversation={handlePress}
        onPressNewChat={() => {}}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});

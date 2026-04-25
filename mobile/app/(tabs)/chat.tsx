import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import ChatHomeScreen from '@/features/chat/components/ChatHomeScreen';
import { mockConversations } from '@/features/chat/services/chatMockData';
import { mockInboxItems } from '@/features/inbox/services/inboxMockData';

export default function ChatTab() {
  const router = useRouter();
  const [conversations] = useState(mockConversations);

  return (
    <SafeAreaView style={s.safe}>
      <ChatHomeScreen
        conversations={conversations}
        onPressConversation={(id) => router.push(`/chat/${id}` as any)}
        onPressNewChat={() => {}}
        activeTab="chat"
        onPressTab={(tab) => {
          if (tab === 'inbox') router.push('/(tabs)/inbox' as any);
        }}
        inboxBadgeCount={mockInboxItems.length}
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

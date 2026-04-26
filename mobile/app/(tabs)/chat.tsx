import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import ChatHomeScreen from '@/features/chat/components/ChatHomeScreen';
import { fetchConversations } from '@/features/chat/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { type Conversation } from '@/types';

export default function ChatTab() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const setConversations = useChatStore((s) => s.setConversations);
  const conversations = useChatStore((s) => s.conversations);

  // 拉取所有 endpoint 下所有 agent 的 conversations
  useQuery({
    queryKey: ['conversations', endpoints.map((e) => e.id)],
    queryFn: async () => {
      const agents = await fetchAllAgents(endpoints);
      const all: Conversation[] = [];
      await Promise.all(
        agents.map(async (agent) => {
          const ep = endpoints.find((e) => e.id === agent.endpoint_id);
          if (!ep) return;
          try {
            const convs = await fetchConversations(
              ep.base_url,
              ep.token,
              agent.id,
              ep.id,
              agent.name,
            );
            all.push(...convs);
          } catch {
            /* skip offline endpoints */
          }
        }),
      );
      // 按 last_message_at 降序排列
      all.sort((a, b) => b.last_message_at - a.last_message_at);
      setConversations(all);
      return all;
    },
    enabled: endpoints.length > 0,
    refetchInterval: 30_000,
  });

  const handlePress = (conv: Conversation) => {
    router.push(`/chat/${conv.id}?endpoint_id=${conv.endpoint_id}`);
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

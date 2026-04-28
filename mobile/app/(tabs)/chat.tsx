import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import ChatHomeScreen from '@/features/chat/components/ChatHomeScreen';
import { fetchConversations, deleteConversation } from '@/features/chat/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { type Conversation } from '@/types';

export default function ChatTab() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const setConversations = useChatStore((s) => s.setConversations);
  const conversations = useChatStore((s) => s.conversations);
  const removeConversation = useChatStore((s) => s.removeConversation);
  const restoreConversation = useChatStore((s) => s.restoreConversation);

  const { refetch, isFetching } = useQuery({
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
      all.sort((a, b) => b.last_message_at - a.last_message_at);
      setConversations(all);
      return all;
    },
    enabled: endpoints.length > 0,
    refetchInterval: 30_000,
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const handlePress = (conv: Conversation) => {
    router.push(`/chat/${conv.id}?endpoint_id=${conv.endpoint_id}`);
  };

  const handleDelete = useCallback(
    async (id: string) => {
      const index = conversations.findIndex((c) => c.id === id);
      const conv = conversations[index];
      if (!conv) return;

      // Optimistic remove
      removeConversation(id);

      const ep = endpoints.find((e) => e.id === conv.endpoint_id);
      if (!ep) return;

      try {
        await deleteConversation(ep.base_url, ep.token, id);
      } catch {
        // Restore on failure
        restoreConversation(conv, index);
      }
    },
    [conversations, endpoints, removeConversation, restoreConversation],
  );

  return (
    <SafeAreaView style={s.safe}>
      <ChatHomeScreen
        conversations={conversations}
        onPressConversation={handlePress}
        onPressNewChat={() => {}}
        onDeleteConversation={handleDelete}
        isRefreshing={isFetching}
        onRefresh={refetch}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});

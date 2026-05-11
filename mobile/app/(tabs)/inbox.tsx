import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { sendConversationAnswer } from '@/features/chat/services/chatService';
import InboxScreen from '@/features/inbox/components/InboxScreen';
import { markAskAnswered } from '@/features/inbox/services/inboxService';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { useInboxStore } from '@/store/inboxStore';
import { type InboxItem } from '@/types';

export default function InboxTab() {
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const removeItem = useInboxStore((s) => s.removeItem);
  const load = useInboxStore((s) => s.load);
  const markAnswered = useChatStore((s) => s.markAnswered);
  const endpoints = useEndpointStore((s) => s.endpoints);
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void handleRefresh();
    }, [handleRefresh]),
  );

  const handleOpen = (item: InboxItem) => {
    void markRead(item.id);
    if (item.conversation_id) {
      router.push(`/chat/${item.conversation_id}?endpoint_id=${item.endpoint_id}`);
    }
  };

  const handleAnswer = async (
    item: InboxItem,
    ask_id: string,
    choice_id?: string,
    freeform?: string,
  ) => {
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep) return;
    try {
      await sendConversationAnswer(ep.base_url, ep.token, item.conversation_id, {
        ask_id,
        choice_id,
        freeform,
      });
      await markAskAnswered(ask_id, item.conversation_id, choice_id);
      await removeItem(item.id);
      markAnswered(item.conversation_id, ask_id, choice_id);
    } catch {
      /* ignore */
    }
  };

  const handleAnswerMulti = async (
    item: InboxItem,
    ask_id: string,
    choice_ids: Record<string, string>,
  ) => {
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep) return;
    try {
      await sendConversationAnswer(ep.base_url, ep.token, item.conversation_id, {
        ask_id,
        choice_ids,
      });
      await markAskAnswered(ask_id, item.conversation_id, undefined, choice_ids);
      await removeItem(item.id);
      markAnswered(item.conversation_id, ask_id, undefined, choice_ids);
    } catch {
      /* ignore */
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <InboxScreen
        items={items}
        onOpen={handleOpen}
        onAnswer={(item, ask_id, choice_id, freeform) => {
          void handleAnswer(item, ask_id, choice_id, freeform);
        }}
        onAnswerMulti={(item, ask_id, choice_ids) => {
          void handleAnswerMulti(item, ask_id, choice_ids);
        }}
        onDelete={(id) => void removeItem(id)}
        isRefreshing={refreshing}
        onRefresh={() => {
          void handleRefresh();
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
});

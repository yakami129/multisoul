import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useInboxStore } from '@/store/inboxStore';
import { useEndpointStore } from '@/store/endpointStore';
import InboxScreen from '@/features/inbox/components/InboxScreen';
import { InboxItem } from '@/types';
import { sendConversationAnswer } from '@/features/chat/services/chatService';

export default function InboxTab() {
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const endpoints = useEndpointStore((s) => s.endpoints);
  const router = useRouter();

  const handleOpen = (item: InboxItem) => {
    markRead(item.id);
    if (item.conversation_id) {
      router.push(`/chat/${item.conversation_id}?endpoint_id=${item.endpoint_id}` as any);
    }
  };

  const handleAnswer = async (
    item: InboxItem,
    ask_id: string,
    choice_id?: string,
    freeform?: string
  ) => {
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep) return;
    try {
      await sendConversationAnswer(ep.base_url, ep.token, item.conversation_id, {
        ask_id, choice_id, freeform,
      });
      markRead(item.id);
    } catch { /* ignore */ }
  };

  const handleAnswerMulti = async (
    item: InboxItem,
    ask_id: string,
    choice_ids: Record<string, string>
  ) => {
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep) return;
    try {
      await sendConversationAnswer(ep.base_url, ep.token, item.conversation_id, {
        ask_id, choice_ids,
      });
      markRead(item.id);
    } catch { /* ignore */ }
  };

  return (
    <SafeAreaView style={s.safe}>
      <InboxScreen
        items={items}
        onOpen={handleOpen}
        onAnswer={handleAnswer}
        onAnswerMulti={handleAnswerMulti}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});

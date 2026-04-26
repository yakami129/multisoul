import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useInboxStore } from '@/store/inboxStore';
import InboxScreen from '@/features/inbox/components/InboxScreen';
import { InboxItem } from '@/types';

export default function InboxTab() {
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const router = useRouter();

  const handleOpen = (item: InboxItem) => {
    markRead(item.id);
    if (item.conversation_id) {
      router.push(`/chat/${item.conversation_id}?endpoint_id=${item.endpoint_id}`);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <InboxScreen items={items} onOpen={handleOpen} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});

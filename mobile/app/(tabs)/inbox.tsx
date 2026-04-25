import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import InboxScreen from '@/features/inbox/components/InboxScreen';
import AnswerModal from '@/features/inbox/components/AnswerModal';
import { mockInboxItems } from '@/features/inbox/services/inboxMockData';
import { InboxItem } from '@/features/inbox/types';

export default function InboxTab() {
  const [items, setItems] = useState(mockInboxItems);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handleAnswer = (item: InboxItem) => {
    setSelectedItem(item);
    setModalVisible(true);
  };

  const handleDismiss = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleConfirm = (itemId: string, _selectedOptionId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setModalVisible(false);
    setSelectedItem(null);
  };

  return (
    <SafeAreaView style={s.safe}>
      <InboxScreen
        items={items}
        onAnswer={handleAnswer}
        onDismiss={handleDismiss}
      />
      <AnswerModal
        visible={modalVisible}
        item={selectedItem}
        onClose={() => {
          setModalVisible(false);
          setSelectedItem(null);
        }}
        onConfirm={handleConfirm}
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

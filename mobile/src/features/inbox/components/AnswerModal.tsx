import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, TouchableWithoutFeedback,
} from 'react-native';
import { X } from 'lucide-react-native';
import AskQuestionCard from '../../chat/components/AskQuestionCard';
import { InboxItem } from '../types';

interface Props {
  visible: boolean;
  item: InboxItem | null;
  onClose: () => void;
  onConfirm: (itemId: string, selectedOptionId: string) => void;
}

export default function AnswerModal({ visible, item, onClose, onConfirm }: Props) {
  if (!item) return null;

  const options = item.payload?.options ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback>
            <View style={s.sheet}>
              <View style={s.sheetHeader}>
                <Text style={s.sheetTitle}>RESPOND TO AGENT</Text>
                <TouchableOpacity onPress={onClose}>
                  <X size={20} color="#2D8B2D" />
                </TouchableOpacity>
              </View>

              <View style={s.agentRow}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{item.agent_id.slice(0, 2).toUpperCase()}</Text>
                </View>
                <View>
                  <Text style={s.agentName}>{item.title}</Text>
                  <Text style={s.agentTimestamp}>
                    {new Date(item.received_at).toLocaleString()}
                  </Text>
                </View>
              </View>

              <View style={s.cardWrap}>
                <AskQuestionCard
                  question={item.payload?.prompt ?? item.body}
                  subtitle="Select one option to continue"
                  options={options}
                  onCancel={onClose}
                  onConfirm={(selectedId) => onConfirm(item.id, selectedId)}
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: 'rgba(4,13,4,0.85)', justifyContent: 'flex-end' },
  sheet:          { backgroundColor: '#061206', borderTopLeftRadius: 2, borderTopRightRadius: 2,
                    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
                    borderColor: '#0F2B0F', paddingBottom: 40 },
  sheetHeader:    { height: 52, flexDirection: 'row', alignItems: 'center',
                    justifyContent: 'space-between', paddingHorizontal: 16,
                    borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  sheetTitle:     { fontFamily: 'Anton', fontSize: 16, color: '#20C20E', letterSpacing: 1 },
  agentRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
                    borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  avatar:         { width: 36, height: 36, borderRadius: 18, backgroundColor: '#0F2B0F',
                    alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontFamily: 'Anton', fontSize: 12, color: '#20C20E' },
  agentName:      { fontFamily: 'Anton', fontSize: 14, color: '#20C20E' },
  agentTimestamp: { fontFamily: 'Inter', fontSize: 11, color: '#0F6B0F' },
  cardWrap:       { padding: 16, alignItems: 'center' },
});

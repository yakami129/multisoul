import { X } from 'lucide-react-native';
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import AskQuestionCard from '../../chat/components/AskQuestionCard';
import { type InboxItem } from '../types';

interface Props {
  visible: boolean;
  item: InboxItem | null;
  onClose: () => void;
  onConfirm: (itemId: string, selectedOptionId: string) => void;
}

export default function AnswerModal({ visible, item, onClose, onConfirm }: Props) {
  if (!item) return null;

  const q = item.payload?.questions?.[0];
  const options = q?.options ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback>
            <View style={s.sheet}>
              <View style={s.sheetHeader}>
                <Text style={s.sheetTitle}>RESPOND TO AGENT</Text>
                <TouchableOpacity onPress={onClose}>
                  <X size={20} color="#888888" />
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
                  question={q?.text ?? item.body}
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  sheetHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  sheetTitle: { fontFamily: 'Inter', fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
  agentName: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  agentTimestamp: { fontFamily: 'Inter', fontSize: 11, color: '#555555' },
  cardWrap: { padding: 16, alignItems: 'center' },
});

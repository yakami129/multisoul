import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
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

const MOCK_OPTIONS = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'later', label: 'Remind me later' },
];

export default function AnswerModal({ visible, item, onClose, onConfirm }: Props) {
  if (!item) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback>
            <View style={s.sheet}>
              {/* Sheet header */}
              <View style={s.sheetHeader}>
                <Text style={s.sheetTitle}>RESPOND TO AGENT</Text>
                <TouchableOpacity onPress={onClose}>
                  <X size={20} color="#2D8B2D" />
                </TouchableOpacity>
              </View>

              {/* Agent info */}
              <View style={s.agentRow}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{item.agentInitials}</Text>
                </View>
                <View>
                  <Text style={s.agentName}>{item.agentName}</Text>
                  <Text style={s.agentTimestamp}>{item.timestamp}</Text>
                </View>
              </View>

              {/* Question card */}
              <View style={s.cardWrap}>
                <AskQuestionCard
                  question={item.question}
                  subtitle="Select one option to continue"
                  options={MOCK_OPTIONS}
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 13, 4, 0.85)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#061206',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#0F2B0F',
    paddingBottom: 40,
  },
  sheetHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  sheetTitle: {
    fontFamily: 'Anton',
    fontSize: 16,
    color: '#20C20E',
    letterSpacing: 1,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Anton',
    fontSize: 12,
    color: '#20C20E',
  },
  agentName: {
    fontFamily: 'Anton',
    fontSize: 14,
    color: '#20C20E',
  },
  agentTimestamp: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#0F6B0F',
  },
  cardWrap: {
    padding: 16,
    alignItems: 'center',
  },
});

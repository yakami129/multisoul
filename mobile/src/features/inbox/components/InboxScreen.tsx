import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SlidersHorizontal, CircleCheck, Info } from 'lucide-react-native';
import { InboxItem } from '../types';

interface Props {
  items: InboxItem[];
  onAnswer: (item: InboxItem) => void;
  onDismiss: (id: string) => void;
}

function PendingState({ items, onAnswer, onDismiss }: Props) {
  return (
    <>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerTitle}>INBOX</Text>
          <Text style={s.headerSub}>{items.length} PENDING RESPONSES</Text>
        </View>
        <SlidersHorizontal size={20} color="#2D8B2D" />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {items.map((item) => (
          <View key={item.id} style={s.cardWrap}>
            <View style={s.card}>
              {/* Card header */}
              <View style={s.cardHeader}>
                <View style={s.cardHeaderLeft}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{item.agentInitials}</Text>
                  </View>
                  <Text style={s.agentName}>{item.agentName}</Text>
                </View>
                <View style={s.cardHeaderRight}>
                  <Text style={s.timestamp}>{item.timestamp}</Text>
                </View>
              </View>

              {/* Card body */}
              <View style={s.cardBody}>
                <Text style={s.questionText}>{item.question}</Text>
                <View style={s.tag}>
                  <Text style={s.tagText}>{item.tag}</Text>
                </View>
              </View>

              {/* Card actions */}
              <View style={s.cardActions}>
                <TouchableOpacity
                  style={s.dismissBtn}
                  onPress={() => onDismiss(item.id)}
                >
                  <Text style={s.dismissText}>Dismiss</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.answerBtn}
                  onPress={() => onAnswer(item)}
                >
                  <Text style={s.answerText}>Answer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

function EmptyState() {
  return (
    <>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerTitle}>INBOX</Text>
          <Text style={s.headerSubGreen}>ALL CAUGHT UP</Text>
        </View>
        <SlidersHorizontal size={20} color="#2D8B2D" />
      </View>

      <View style={s.emptyBody}>
        <View style={s.emptyIconWrap}>
          <CircleCheck size={36} color="#33FF33" />
        </View>
        <Text style={s.emptyTitle}>ALL CAUGHT UP!</Text>
        <Text style={s.emptyDesc}>No pending questions from your agents.</Text>
        <View style={s.infoBox}>
          <View style={s.infoRow}>
            <Info size={14} color="#2D8B2D" />
            <Text style={s.infoText}>
              You will be notified when an agent needs your input.
            </Text>
          </View>
        </View>
      </View>
    </>
  );
}

export default function InboxScreen({ items, onAnswer, onDismiss }: Props) {
  return (
    <View style={s.root}>
      {items.length > 0 ? (
        <PendingState items={items} onAnswer={onAnswer} onDismiss={onDismiss} />
      ) : (
        <EmptyState />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040D04',
  },
  header: {
    height: 52,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  headerLeft: {
    gap: 2,
  },
  headerTitle: {
    fontFamily: 'Anton',
    fontSize: 20,
    color: '#20C20E',
  },
  headerSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#FFB000',
    letterSpacing: 1.5,
  },
  headerSubGreen: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#2D8B2D',
    letterSpacing: 1.5,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 8,
    gap: 1,
  },
  cardWrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  card: {
    backgroundColor: '#061206',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    overflow: 'hidden',
  },
  cardHeader: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Anton',
    fontSize: 10,
    color: '#20C20E',
  },
  agentName: {
    fontFamily: 'Anton',
    fontSize: 13,
    color: '#20C20E',
  },
  timestamp: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#0F6B0F',
  },
  cardBody: {
    padding: 16,
    gap: 8,
  },
  questionText: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#20C20E',
    lineHeight: 18,
  },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: '#0A1A0A',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#2D8B2D',
  },
  cardActions: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#0F2B0F',
  },
  dismissBtn: {
    flex: 1,
    height: 32,
    borderRadius: 4,
    backgroundColor: '#040D04',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#2D8B2D',
  },
  answerBtn: {
    flex: 1,
    height: 32,
    borderRadius: 4,
    backgroundColor: '#20C20E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: '#040D04',
  },
  // Empty state
  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#061206',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: 'Anton',
    fontSize: 24,
    color: '#20C20E',
  },
  emptyDesc: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#147A16',
    textAlign: 'center',
    maxWidth: 260,
  },
  infoBox: {
    backgroundColor: '#061206',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    padding: 16,
    width: '100%',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  infoText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#2D8B2D',
    flex: 1,
    lineHeight: 18,
  },
});

import {
  CircleCheck,
  Info,
  MessageCircle,
  PanelBottomOpen,
  SlidersHorizontal,
} from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { AskQuestionCard, MultiAskQuestionCard } from '@/features/chat';
import { type AskQuestionPayload, type InboxItem } from '@/types';

interface Props {
  items: InboxItem[];
  title?: string;
  onOpen: (item: InboxItem) => void;
  onAnswer: (item: InboxItem, ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti: (item: InboxItem, ask_id: string, choice_ids: Record<string, string>) => void;
  onDelete: (id: string) => void;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

function AskContent({
  item,
  onAnswer,
  onAnswerMulti,
  setExpandedId,
}: {
  item: InboxItem;
  onAnswer: (item: InboxItem, ask_id: string, choice_id?: string) => void;
  onAnswerMulti: (item: InboxItem, ask_id: string, choice_ids: Record<string, string>) => void;
  setExpandedId: (id: string | null) => void;
}) {
  const p = item.payload as AskQuestionPayload;
  if (p.questions.length === 1) {
    const q = p.questions[0];
    return (
      <AskQuestionCard
        question={q?.text ?? item.body}
        options={q?.options ?? []}
        onCancel={() => {
          onAnswer(item, p.ask_id, '__cancelled__');
          setExpandedId(null);
        }}
        onConfirm={(choice_id) => {
          onAnswer(item, p.ask_id, choice_id);
          setExpandedId(null);
        }}
      />
    );
  }
  return (
    <MultiAskQuestionCard
      questions={p.questions}
      onCancel={() => {
        onAnswer(item, p.ask_id, '__cancelled__');
        setExpandedId(null);
      }}
      onConfirm={(choice_ids) => {
        onAnswerMulti(item, p.ask_id, choice_ids);
        setExpandedId(null);
      }}
    />
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function InboxScreen({
  items,
  title = 'Inbox',
  onOpen,
  onAnswer,
  onAnswerMulti,
  onDelete,
  isRefreshing = false,
  onRefresh,
}: Props) {
  const pendingCount = items.filter((i) => i.kind === 'pending_question' && !i.read_at).length;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={s.headerTitle}>{title}</Text>
          <SlidersHorizontal size={22} color="#888888" />
        </View>
        <Text style={s.headerSub}>
          {pendingCount > 0 ? `${pendingCount} pending responses` : 'All caught up'}
        </Text>
      </View>
      <View style={s.headerDivider} />

      {items.length === 0 ? (
        <View style={s.emptyBody}>
          <View style={s.emptyIconWrap}>
            <CircleCheck size={36} color="#4CAF50" />
          </View>
          <Text style={s.emptyTitle}>All caught up!</Text>
          <Text style={s.emptyDesc}>No messages from your agents.</Text>
          <View style={s.infoRow}>
            <Info size={14} color="#555555" />
            <Text style={s.infoText}>You will be notified when an agent needs your input.</Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
          renderItem={({ item, index }) => {
            const unread = item.read_at === null;
            const isPendingQuestion = item.kind === 'pending_question' && item.payload !== null;
            const isExpanded = expandedId === item.id;
            const isLast = index === items.length - 1;

            return (
              <Swipeable
                ref={(ref) => {
                  if (ref) swipeableRefs.current.set(item.id, ref);
                  else swipeableRefs.current.delete(item.id);
                }}
                onSwipeableOpen={() => {
                  if (openSwipeableRef.current) openSwipeableRef.current.close();
                  openSwipeableRef.current = swipeableRefs.current.get(item.id) ?? null;
                }}
                renderRightActions={() => (
                  <TouchableOpacity
                    style={s.deleteBtn}
                    onPress={() => onDelete(item.id)}
                    accessibilityLabel="Delete item"
                    accessibilityRole="button"
                  >
                    <Text style={s.deleteBtnText}>DELETE</Text>
                  </TouchableOpacity>
                )}
              >
                <View style={[s.card, !isLast && s.cardBorder]}>
                  {/* Top row: avatar + agent name + unread dot + time */}
                  <View style={s.topRow}>
                    <View style={s.topLeft}>
                      <View style={s.avatar}>
                        <Text style={s.avatarText}>{item.title.slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <Text style={s.agentName}>{item.title}</Text>
                      {unread && <View style={s.unreadDot} />}
                    </View>
                    <Text style={s.timeText}>{formatRelativeTime(item.received_at)}</Text>
                  </View>

                  {/* Question body */}
                  <Text style={s.questionText} numberOfLines={isExpanded ? undefined : 3}>
                    {item.body}
                  </Text>

                  {/* Source chip */}
                  {item.conversation_id ? (
                    <View style={s.chip}>
                      <MessageCircle size={12} color="#666666" />
                      <Text style={s.chipText} numberOfLines={1}>
                        {item.conversation_id}
                      </Text>
                    </View>
                  ) : null}

                  {/* Action row */}
                  {isPendingQuestion && !isExpanded && (
                    <View style={s.actionRow}>
                      <TouchableOpacity
                        style={s.dismissBtn}
                        onPress={() => {
                          const p = item.payload as AskQuestionPayload;
                          onAnswer(item, p.ask_id, '__cancelled__');
                        }}
                        accessibilityLabel="Dismiss"
                      >
                        <Text style={s.dismissText}>Dismiss</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.answerBtn}
                        onPress={() => setExpandedId(item.id)}
                        accessibilityLabel="Answer"
                      >
                        <PanelBottomOpen size={13} color="#FFFFFF" />
                        <Text style={s.answerText}>Answer</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Expanded ask card */}
                  {isPendingQuestion && isExpanded && item.payload && (
                    <View style={s.askWrap}>
                      <AskContent
                        item={item}
                        onAnswer={onAnswer}
                        onAnswerMulti={onAnswerMulti}
                        setExpandedId={setExpandedId}
                      />
                    </View>
                  )}

                  {/* Non-question tap target */}
                  {!isPendingQuestion && (
                    <TouchableOpacity
                      style={StyleSheet.absoluteFill}
                      onPress={() => onOpen(item)}
                      accessibilityLabel="Open item"
                    />
                  )}
                </View>
              </Swipeable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },

  // Header
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontFamily: 'Inter', fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontFamily: 'Inter', fontSize: 14, color: '#FF6B35' },
  headerDivider: { height: 1, backgroundColor: '#1E1E1E' },

  // List
  list: { paddingBottom: 110 },

  // Card
  card: { backgroundColor: '#0D0D0D', padding: 16, gap: 10 },
  cardBorder: { borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },

  // Top row
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  agentName: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF', flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF6B35' },
  timeText: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },

  // Body
  questionText: { fontFamily: 'Inter', fontSize: 15, color: '#DDDDDD', lineHeight: 21 },

  // Chip
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 6,
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: { fontFamily: 'Inter', fontSize: 12, color: '#666666', maxWidth: 200 },

  // Actions
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dismissBtn: {
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dismissText: { fontFamily: 'Inter', fontSize: 13, color: '#666666' },
  answerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#FF6B35',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  answerText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FFFFFF' },

  // Expanded ask
  askWrap: { marginTop: 4 },

  // Delete swipe
  deleteBtn: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
  },
  deleteBtnText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#FF4444',
    letterSpacing: 0.5,
  },

  // Empty state
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontFamily: 'Inter', fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  emptyDesc: {
    fontFamily: 'Inter',
    fontSize: 15,
    color: '#888888',
    textAlign: 'center',
    maxWidth: 260,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  infoText: { fontFamily: 'Inter', fontSize: 12, color: '#555555', flex: 1 },
});

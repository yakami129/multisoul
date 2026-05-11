import { CircleCheck, Info } from 'lucide-react-native';
import React, { useState, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { AskQuestionCard, MultiAskQuestionCard } from '@/features/chat';
import { type InboxItem, type AskQuestionPayload } from '@/types';

interface Props {
  items: InboxItem[];
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

function DeleteAction({ id, onDelete }: { id: string; onDelete: (id: string) => void }) {
  return (
    <TouchableOpacity
      style={s.deleteBtn}
      onPress={() => onDelete(id)}
      accessibilityLabel="Delete item"
      accessibilityRole="button"
    >
      <Text style={s.deleteBtnText}>DELETE</Text>
    </TouchableOpacity>
  );
}

export default function InboxScreen({
  items,
  onOpen,
  onAnswer,
  onAnswerMulti,
  onDelete,
  isRefreshing = false,
  onRefresh,
}: Props) {
  const unreadCount = items.filter((i) => !i.read_at).length;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>INBOX</Text>
          <Text style={[s.headerSub, { color: unreadCount > 0 ? '#FF6B35' : '#888888' }]}>
            {unreadCount > 0 ? `${unreadCount} UNREAD` : 'ALL CAUGHT UP'}
          </Text>
        </View>
      </View>

      {items.length === 0 ? (
        <View style={s.emptyBody}>
          <View style={s.emptyIconWrap}>
            <CircleCheck size={36} color="#4CAF50" />
          </View>
          <Text style={s.emptyTitle}>ALL CAUGHT UP!</Text>
          <Text style={s.emptyDesc}>No messages from your agents.</Text>
          <View style={s.infoBox}>
            <View style={s.infoRow}>
              <Info size={14} color="#555555" />
              <Text style={s.infoText}>You will be notified when an agent needs your input.</Text>
            </View>
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
          renderItem={({ item }) => {
            const unread = item.read_at === null;
            const isPendingQuestion = item.kind === 'pending_question' && item.payload !== null;
            const isExpanded = expandedId === item.id;

            return (
              <Swipeable
                ref={(ref) => {
                  if (ref) {
                    swipeableRefs.current.set(item.id, ref);
                  } else {
                    swipeableRefs.current.delete(item.id);
                  }
                }}
                onSwipeableOpen={() => {
                  if (openSwipeableRef.current) {
                    openSwipeableRef.current.close();
                  }
                  openSwipeableRef.current = swipeableRefs.current.get(item.id) ?? null;
                }}
                renderRightActions={() => <DeleteAction id={item.id} onDelete={onDelete} />}
              >
                <View style={s.rowWrap}>
                  <TouchableOpacity
                    style={s.row}
                    onPress={() => {
                      if (isPendingQuestion) {
                        setExpandedId(isExpanded ? null : item.id);
                      } else {
                        onOpen(item);
                      }
                    }}
                  >
                    <View
                      style={[s.unreadBar, { backgroundColor: unread ? '#FF6B35' : 'transparent' }]}
                    />
                    <View style={s.content}>
                      <Text style={s.title}>{item.title}</Text>
                      <Text style={s.body} numberOfLines={isExpanded ? undefined : 2}>
                        {item.body}
                      </Text>
                      <Text style={s.time}>{new Date(item.received_at).toLocaleString()}</Text>
                      {isPendingQuestion && (
                        <Text style={s.tapHint}>
                          {isExpanded ? 'TAP TO COLLAPSE' : 'TAP TO ANSWER'}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>

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
  header: {
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 4,
  },
  headerTitle: { fontFamily: 'Inter', fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontFamily: 'Inter', fontSize: 14 },
  list: { padding: 0, gap: 0 },
  rowWrap: { gap: 0 },
  row: {
    flexDirection: 'column',
    backgroundColor: '#0D0D0D',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  rowInner: { padding: 16, gap: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentName: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  timeText: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },
  agentIcon: {},
  questionText: { fontFamily: 'Inter', fontSize: 15, color: '#DDDDDD', lineHeight: 21 },
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
  chipText: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dismissBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  dismissText: { fontFamily: 'Inter', fontSize: 13, color: '#666666' },
  answerBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  answerText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FF6B35' },
  unreadBar: { width: 2 },
  content: { flex: 1, padding: 12, gap: 4 },
  title: { fontFamily: 'Anton', fontSize: 13, color: '#FFFFFF', letterSpacing: 1 },
  body: { fontFamily: 'Geist', fontSize: 13, color: '#DDDDDD', lineHeight: 18 },
  time: { fontFamily: 'Inter', fontSize: 11, color: '#555555' },
  tapHint: { fontFamily: 'Inter', fontSize: 11, color: '#555555', letterSpacing: 0.5 },
  askWrap: { paddingHorizontal: 16, paddingBottom: 16 },
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
  infoBox: {},
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
});

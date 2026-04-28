import { CircleCheck, Info } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import AskQuestionCard from '@/features/chat/components/AskQuestionCard';
import MultiAskQuestionCard from '@/features/chat/components/MultiAskQuestionCard';
import { type InboxItem, type AskQuestionPayload } from '@/types';

interface Props {
  items: InboxItem[];
  onOpen: (item: InboxItem) => void;
  onAnswer: (item: InboxItem, ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti: (item: InboxItem, ask_id: string, choice_ids: Record<string, string>) => void;
  onDelete: (id: string) => void;
}

export default function InboxScreen({ items, onOpen, onAnswer, onAnswerMulti, onDelete }: Props) {
  const unreadCount = items.filter((i) => !i.read_at).length;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>INBOX</Text>
          <Text style={[s.headerSub, { color: unreadCount > 0 ? '#FFB000' : '#2D8B2D' }]}>
            {unreadCount > 0 ? `${unreadCount} UNREAD` : 'ALL CAUGHT UP'}
          </Text>
        </View>
      </View>

      {items.length === 0 ? (
        <View style={s.emptyBody}>
          <View style={s.emptyIconWrap}>
            <CircleCheck size={36} color="#33FF33" />
          </View>
          <Text style={s.emptyTitle}>ALL CAUGHT UP!</Text>
          <Text style={s.emptyDesc}>No messages from your agents.</Text>
          <View style={s.infoBox}>
            <View style={s.infoRow}>
              <Info size={14} color="#2D8B2D" />
              <Text style={s.infoText}>You will be notified when an agent needs your input.</Text>
            </View>
          </View>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => {
            const unread = item.read_at === null;
            const isPendingQuestion = item.kind === 'pending_question' && item.payload !== null;
            const isExpanded = expandedId === item.id;

            const renderDeleteAction = (id: string) => (
              <TouchableOpacity style={s.deleteBtn} onPress={() => onDelete(id)}>
                <Text style={s.deleteBtnText}>DELETE</Text>
              </TouchableOpacity>
            );

            return (
              <Swipeable renderRightActions={() => renderDeleteAction(item.id)}>
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
                      style={[s.unreadBar, { backgroundColor: unread ? '#20C20E' : 'transparent' }]}
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
                      {(() => {
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
                      })()}
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
  root: { flex: 1, backgroundColor: '#040D04' },
  header: {
    height: 52,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  headerTitle: { fontFamily: 'Anton', fontSize: 20, color: '#20C20E' },
  headerSub: { fontFamily: 'Inter', fontSize: 11, letterSpacing: 1.5 },
  list: { padding: 16, gap: 8 },
  rowWrap: { gap: 0 },
  row: {
    flexDirection: 'row',
    backgroundColor: '#061206',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    borderRadius: 2,
  },
  unreadBar: { width: 2 },
  content: { flex: 1, padding: 12, gap: 4 },
  title: { fontFamily: 'Anton', fontSize: 13, color: '#20C20E', letterSpacing: 1 },
  body: { fontFamily: 'Geist', fontSize: 13, color: '#147A16', lineHeight: 18 },
  time: { fontFamily: 'Inter', fontSize: 11, color: '#0F6B0F' },
  tapHint: { fontFamily: 'Inter', fontSize: 10, color: '#2D8B2D', letterSpacing: 1 },
  askWrap: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#0F2B0F',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    padding: 12,
    backgroundColor: '#061206',
  },
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
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
  emptyTitle: { fontFamily: 'Anton', fontSize: 24, color: '#20C20E' },
  emptyDesc: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#147A16',
    textAlign: 'center',
    maxWidth: 260,
  },
  infoBox: {
    backgroundColor: '#061206',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    padding: 16,
    width: '100%',
  },
  infoRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  infoText: { fontFamily: 'Inter', fontSize: 12, color: '#2D8B2D', flex: 1, lineHeight: 18 },
  deleteBtn: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3D0000',
    borderWidth: 1,
    borderColor: '#5C0000',
    borderRadius: 0,
  },
  deleteBtnText: {
    fontFamily: 'Anton',
    fontSize: 11,
    color: '#FF3333',
    letterSpacing: 1,
  },
});

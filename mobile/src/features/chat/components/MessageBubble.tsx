import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WsMessage, AskQuestionPayload } from '@/types';
import AskQuestionCard from './AskQuestionCard';
import MultiAskQuestionCard from './MultiAskQuestionCard';
import { ToolCallRow } from './ToolCallRow';

interface Props {
  msg: WsMessage;
  onAnswer?: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti?: (ask_id: string, choice_ids: Record<string, string>) => void;
}

export function MessageBubble({ msg, onAnswer, onAnswerMulti }: Props) {
  switch (msg.role) {
    case 'user_text':
      return (
        <View style={s.userWrap}>
          <View style={s.userBubble}>
            <Text style={s.userText}>{(msg.payload as any).text}</Text>
          </View>
        </View>
      );

    case 'agent_text':
      return (
        <View style={s.aiWrap}>
          <View style={s.aiBubble}>
            <Text style={s.aiText}>{(msg.payload as any).text}</Text>
          </View>
        </View>
      );

    case 'tool_call':
      return (
        <View style={s.aiWrap}>
          <ToolCallRow call={msg.payload as any} />
        </View>
      );

    case 'tool_result':
      // Rendered inline by ToolCallRow — skip standalone rendering
      return null;

    case 'ask_question': {
      const p = msg.payload as AskQuestionPayload;
      if (p.questions.length === 1) {
        const q = p.questions[0];
        return (
          <View style={s.aiWrap}>
            <AskQuestionCard
              question={q.text}
              options={q.options}
              onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
              onConfirm={(id) => onAnswer?.(p.ask_id, id)}
            />
          </View>
        );
      }
      return (
        <View style={s.aiWrap}>
          <MultiAskQuestionCard
            questions={p.questions}
            onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
            onConfirm={(answers) => onAnswerMulti?.(p.ask_id, answers)}
          />
        </View>
      );
    }

    // case 'task_status': {
    //   const p = msg.payload as any;
    //   const color = p.status === 'completed' ? '#33FF33' : '#FFB000';
    //   return (
    //     <View style={s.statusRow}>
    //       <View style={[s.statusLine, { backgroundColor: color }]} />
    //       <Text style={[s.statusText, { color }]}>
    //         {p.status.toUpperCase()} — {p.summary}
    //       </Text>
    //       <View style={[s.statusLine, { backgroundColor: color }]} />
    //     </View>
    //   );
    // }

    default:
      return null;
  }
}

const s = StyleSheet.create({
  userWrap: { width: '100%', alignItems: 'flex-end' },
  aiWrap:   { width: '100%', alignItems: 'flex-start' },
  userBubble: {
    maxWidth: 240, backgroundColor: '#20C20E', borderRadius: 2,
    borderTopRightRadius: 0, padding: 12,
  },
  aiBubble: {
    maxWidth: 280, backgroundColor: '#061206', borderRadius: 2,
    borderTopLeftRadius: 0, padding: 12,
    borderWidth: 1, borderColor: '#0F2B0F',
  },
  userText: { fontFamily: 'Geist', fontSize: 14, color: '#040D04', lineHeight: 20 },
  aiText:   { fontFamily: 'Geist', fontSize: 14, color: '#20C20E', lineHeight: 20 },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8,
  },
  statusLine: { flex: 1, height: 1 },
  statusText: { fontFamily: 'Inter', fontSize: 11, letterSpacing: 1 },
});

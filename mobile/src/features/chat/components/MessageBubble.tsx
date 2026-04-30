import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text, StyleSheet } from 'react-native';
import {
  type WsMessage,
  type AskQuestionPayload,
  type AgentTextPayload,
  type UserTextPayload,
  type ToolCallPayload,
} from '@/types';
import AskQuestionCard from './AskQuestionCard';
import MultiAskQuestionCard from './MultiAskQuestionCard';
import { ToolCallRow } from './ToolCallRow';

const TYPEWRITER_INTERVAL_MS = 18;
const WAITING_PHRASE = 'Thinking...';
const WAITING_TEXT_WIDTH = 112;
const WAITING_SHINE_WIDTH = 48;

interface Props {
  msg: WsMessage;
  onAnswer?: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti?: (ask_id: string, choice_ids: Record<string, string>) => void;
  typewriter?: boolean;
  waiting?: boolean;
}

export function MessageBubble({
  msg,
  onAnswer,
  onAnswerMulti,
  typewriter = false,
  waiting = false,
}: Props) {
  const agentText = msg.role === 'agent_text' ? ((msg.payload as AgentTextPayload).text ?? '') : '';
  const [visibleChars, setVisibleChars] = useState(typewriter ? 0 : agentText.length);
  const shineProgress = useRef(new Animated.Value(0)).current;
  const shineTranslateX = shineProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-WAITING_SHINE_WIDTH, WAITING_TEXT_WIDTH],
  });
  const shineTextTranslateX = shineProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [WAITING_SHINE_WIDTH, -WAITING_TEXT_WIDTH],
  });

  useEffect(() => {
    if (!typewriter || msg.role !== 'agent_text') {
      setVisibleChars(agentText.length);
      return undefined;
    }

    setVisibleChars(0);
    const timer = setInterval(() => {
      setVisibleChars((count: number) => {
        if (count >= agentText.length) {
          clearInterval(timer);
          return count;
        }
        return Math.min(count + 1, agentText.length);
      });
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [agentText, msg.role, msg.seq, typewriter]);

  useEffect(() => {
    if (!waiting) return undefined;

    shineProgress.setValue(0);
    const shineLoop = Animated.loop(
      Animated.timing(shineProgress, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    shineLoop.start();

    return () => {
      shineLoop.stop();
    };
  }, [shineProgress, waiting]);

  if (waiting) {
    return (
      <View style={s.aiWrap}>
        <View style={s.waitingBubble}>
          <View style={s.waitingTextWrap}>
            <Text accessibilityLabel={WAITING_PHRASE} style={s.waitingText}>
              {WAITING_PHRASE}
            </Text>
            <Animated.View
              pointerEvents="none"
              style={[s.waitingShine, { transform: [{ translateX: shineTranslateX }] }]}
            >
              <Animated.Text
                style={[
                  s.waitingText,
                  s.waitingTextHighlight,
                  { transform: [{ translateX: shineTextTranslateX }] },
                ]}
              >
                {WAITING_PHRASE}
              </Animated.Text>
            </Animated.View>
          </View>
        </View>
      </View>
    );
  }

  switch (msg.role) {
    case 'user_text':
      return (
        <View style={s.userWrap}>
          <View style={s.userBubble}>
            <Text style={s.userText}>{(msg.payload as UserTextPayload).text}</Text>
          </View>
        </View>
      );

    case 'agent_text': {
      const isScanning = typewriter && visibleChars < agentText.length;
      const displayedText = typewriter
        ? `${agentText.slice(0, visibleChars)}${isScanning ? '▌' : ''}`
        : agentText;

      return (
        <View style={s.aiWrap}>
          <View style={s.aiBubble}>
            <Text style={[s.aiText, isScanning && s.typingText]}>{displayedText}</Text>
          </View>
        </View>
      );
    }

    case 'tool_call':
      return (
        <View style={s.aiWrap}>
          <ToolCallRow call={msg.payload as ToolCallPayload} />
        </View>
      );

    case 'tool_result':
      // Rendered inline by ToolCallRow — skip standalone rendering
      return null;

    case 'ask_question': {
      const p = msg.payload as AskQuestionPayload;
      if (p.questions.length === 1) {
        const q = p.questions[0];
        if (q.multi_select) {
          const initialIds = msg.answeredChoiceId
            ? new Set(msg.answeredChoiceId.split(','))
            : undefined;
          return (
            <View style={s.aiWrap}>
              <AskQuestionCard
                question={q.text}
                options={q.options}
                multiSelect
                answered={msg.answered}
                initialSelectedIds={initialIds}
                onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
                onConfirm={(ids) => onAnswerMulti?.(p.ask_id, { '0': ids })}
              />
            </View>
          );
        }
        return (
          <View style={s.aiWrap}>
            <AskQuestionCard
              question={q.text}
              options={q.options}
              answered={msg.answered}
              initialSelectedId={msg.answeredChoiceId}
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
            answered={msg.answered}
            initialAnswers={msg.answeredChoiceIds}
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
  aiWrap: { width: '100%', alignItems: 'flex-start' },
  userBubble: {
    maxWidth: 240,
    backgroundColor: '#20C20E',
    borderRadius: 2,
    borderTopRightRadius: 0,
    padding: 12,
  },
  aiBubble: {
    maxWidth: 280,
    backgroundColor: '#061206',
    borderRadius: 2,
    borderTopLeftRadius: 0,
    padding: 12,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  waitingBubble: {
    maxWidth: 280,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  userText: { fontFamily: 'Geist', fontSize: 14, color: '#040D04', lineHeight: 20 },
  aiText: { fontFamily: 'Geist', fontSize: 14, color: '#20C20E', lineHeight: 20 },
  typingText: {
    color: '#20C20E',
    textShadowColor: '#20C20E',
    textShadowRadius: 4,
  },
  waitingText: {
    fontFamily: 'Geist Mono',
    fontSize: 14,
    fontWeight: '600',
    color: '#5FA65F',
    lineHeight: 20,
    letterSpacing: 0.4,
  },
  waitingTextWrap: {
    overflow: 'hidden',
    position: 'relative',
    width: WAITING_TEXT_WIDTH,
  },
  waitingShine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: WAITING_SHINE_WIDTH,
    overflow: 'hidden',
  },
  waitingTextHighlight: {
    color: '#D7FFD2',
    width: WAITING_TEXT_WIDTH,
    textShadowColor: '#20C20E',
    textShadowRadius: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  statusLine: { flex: 1, height: 1 },
  statusText: { fontFamily: 'Inter', fontSize: 11, letterSpacing: 1 },
});

import { X } from 'lucide-react-native';
import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text, StyleSheet, Image, Modal, Pressable } from 'react-native';
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
const DOT_PULSE_DURATION = 600;

interface Props {
  msg: WsMessage;
  onAnswer?: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti?: (ask_id: string, choice_ids: Record<string, string>) => void;
  typewriter?: boolean;
  waiting?: boolean;
  imageUri?: string;
}

export const MessageBubble = memo(function MessageBubble({
  msg,
  onAnswer,
  onAnswerMulti,
  typewriter = false,
  waiting = false,
  imageUri,
}: Props) {
  const agentText = msg.role === 'agent_text' ? ((msg.payload as AgentTextPayload).text ?? '') : '';
  const [visibleChars, setVisibleChars] = useState(typewriter ? 0 : agentText.length);
  const prevTypewriterRef = useRef(typewriter);
  const [previewVisible, setPreviewVisible] = useState(false);
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (!typewriter || msg.role !== 'agent_text') {
      setVisibleChars(agentText.length);
      return undefined;
    }

    // Only reset to 0 when typewriter transitions false→true (new message)
    if (!prevTypewriterRef.current) {
      setVisibleChars(0);
    }

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

  // Track previous typewriter value for transition detection
  useEffect(() => {
    prevTypewriterRef.current = typewriter;
  });

  useEffect(() => {
    if (!waiting) return undefined;

    function pulseDot(anim: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: DOT_PULSE_DURATION,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: DOT_PULSE_DURATION,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
    }

    const a1 = pulseDot(dot1, 0);
    const a2 = pulseDot(dot2, DOT_PULSE_DURATION * 0.4);
    const a3 = pulseDot(dot3, DOT_PULSE_DURATION * 0.8);
    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3, waiting]);

  if (waiting) {
    return (
      <View style={s.aiWrap}>
        <View style={[s.aiBubble, s.waitingBubble]}>
          <Animated.View
            testID="waiting-dot-0"
            accessibilityLabel="Thinking..."
            style={[s.dot, { opacity: dot1 }]}
          />
          <Animated.View testID="waiting-dot-1" style={[s.dot, { opacity: dot2 }]} />
          <Animated.View testID="waiting-dot-2" style={[s.dot, { opacity: dot3 }]} />
        </View>
        <Text testID="waiting-analyzing-text" style={s.analyzingText}>
          Analyzing…
        </Text>
      </View>
    );
  }

  switch (msg.role) {
    case 'user_text': {
      const payload = msg.payload as UserTextPayload;
      const hasImage = !!payload.file_id;

      return (
        <View style={s.userWrap}>
          {hasImage && imageUri ? (
            <Modal
              testID="fullscreen-modal"
              visible={previewVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setPreviewVisible(false)}
            >
              <View style={s.modalOverlay}>
                <Pressable
                  testID="fullscreen-close-btn"
                  style={s.fullscreenClose}
                  onPress={() => setPreviewVisible(false)}
                >
                  <X size={18} color="#20C20E" />
                </Pressable>
                <Image source={{ uri: imageUri }} style={s.previewImage} resizeMode="contain" />
                <Text style={s.previewFilename}>{payload.file_id}</Text>
              </View>
            </Modal>
          ) : null}
          <View style={s.userBubble}>
            {hasImage ? (
              imageUri ? (
                <Pressable testID="user-image-thumb" onPress={() => setPreviewVisible(true)}>
                  <Image source={{ uri: imageUri }} style={s.thumbImage} resizeMode="cover" />
                </Pressable>
              ) : (
                <Text style={s.attachmentPlaceholder}>📎 Image</Text>
              )
            ) : null}
            {payload.text ? (
              <Text style={[s.userText, hasImage ? s.imageCaption : null]}>{payload.text}</Text>
            ) : null}
            {hasImage && imageUri ? <Text style={s.enlargeHint}>Tap to enlarge →</Text> : null}
          </View>
        </View>
      );
    }

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
});

const s = StyleSheet.create({
  userWrap: { width: '100%', alignItems: 'flex-end' },
  aiWrap: { width: '100%', alignItems: 'flex-start' },
  userBubble: {
    width: 240,
    backgroundColor: '#20C20E',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
  },
  aiBubble: {
    width: 280,
    backgroundColor: '#061206',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  waitingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
    width: 64,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  analyzingText: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: '#0F6B0F',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#20C20E',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    width: 64,
    gap: 6,
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
    width: 112,
  },
  waitingShine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 48,
    overflow: 'hidden',
  },
  waitingTextHighlight: {
    color: '#D7FFD2',
    width: 112,
    textShadowColor: '#20C20E',
    textShadowRadius: 8,
  },
  thumbImage: {
    width: 120,
    height: 120,
    borderRadius: 2,
    marginBottom: 4,
  },
  attachmentPlaceholder: {
    fontFamily: 'Geist',
    fontSize: 12,
    color: '#040D04',
    marginBottom: 4,
  },
  imageCaption: {
    marginTop: 4,
  },
  enlargeHint: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: 'rgba(4,13,4,0.8)',
    marginTop: 4,
  },
  fullscreenClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 2,
    backgroundColor: '#0A1A0A',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  previewFilename: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#2D8B2D',
    marginTop: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4,13,4,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '80%',
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

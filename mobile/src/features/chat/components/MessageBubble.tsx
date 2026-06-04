import { X } from 'lucide-react-native';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, Text, StyleSheet, Image, Modal, Pressable } from 'react-native';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import {
  type WsMessage,
  type AskQuestionPayload,
  type AgentTextPayload,
  type UserTextPayload,
  type ToolCallPayload,
  type SystemEventPayload,
} from '@/types';
import AskQuestionCard from './AskQuestionCard';
import { MarkdownMessage } from './MarkdownMessage';
import MultiAskQuestionCard from './MultiAskQuestionCard';
import { ToolCallRow } from './ToolCallRow';

const TYPEWRITER_INTERVAL_MS = 18;
const TYPEWRITER_BULK_GAP_MIN = 140;
const TYPEWRITER_LONG_DOC_MIN = 240;
const TYPEWRITER_LONG_TAIL_SMOOTH = 64;
const TYPEWRITER_MAX_STEP = 18;
const DOT_PULSE_DURATION = 600;

type SegmenterCtor = new (
  locales?: string,
  options?: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> };

function graphemeUnits(raw: string): string[] {
  const segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterCtor }).Segmenter;
  if (segmenter) {
    return Array.from(
      new segmenter(undefined, { granularity: 'grapheme' }).segment(raw),
      (part) => part.segment,
    );
  }
  return Array.from(raw);
}

function joinUnits(units: string[], count: number) {
  return units.slice(0, Math.min(count, units.length)).join('');
}

function stepForGap(gap: number) {
  if (gap <= 0) return 0;
  const frames = 72;
  return Math.min(gap, Math.min(TYPEWRITER_MAX_STEP, Math.max(1, Math.ceil(gap / frames))));
}

function bulkAdvanceEndUnits(units: string[], from: number) {
  const end = units.length;
  for (let i = from; i < end; i++) {
    if (
      units[i] === '\r' &&
      units[i + 1] === '\n' &&
      units[i + 2] === '\r' &&
      units[i + 3] === '\n'
    )
      return i + 4;
    if (units[i] === '\n' && units[i + 1] === '\n') return i + 2;
  }
  for (let i = from; i < end; i++) {
    if (units[i] === '\r' && units[i + 1] === '\n') return i + 2;
    if (units[i] === '\n' || units[i] === '\r') return i + 1;
  }

  const rest = end - from;
  if (rest <= 200) return end;
  const slab = Math.min(Math.max(120, Math.floor(rest / 28)), 360);
  const edge = Math.min(from + slab, end);
  for (let i = edge; i > from + slab * 0.52; i--) if (units[i - 1] === ',') return i;
  for (let i = edge; i > from + slab * 0.42; i--) if (units[i - 1] === ' ') return i;
  return edge;
}

function nextTypewriterCount(units: string[], current: number) {
  const targetLen = units.length;
  const gap = targetLen - current;
  if (gap <= 0) return current;
  const useBulk =
    gap > TYPEWRITER_BULK_GAP_MIN ||
    (targetLen >= TYPEWRITER_LONG_DOC_MIN && gap > TYPEWRITER_LONG_TAIL_SMOOTH);
  return useBulk ? bulkAdvanceEndUnits(units, current) : current + stepForGap(gap);
}

async function probeFailedImageUri(imageUri: string, fileId: string | undefined, seq: number) {
  try {
    const res = await fetch(imageUri, { method: 'GET' });
    recordDiagnosticsEvent('warn', 'chat.image.probe', 'image url probe completed', {
      file_id: fileId,
      seq,
      status: res.status,
      ok: res.ok,
      content_type: res.headers.get('content-type'),
      content_length: res.headers.get('content-length'),
    });
  } catch (error: unknown) {
    recordDiagnosticsEvent('error', 'chat.image.probe', 'image url probe failed', {
      file_id: fileId,
      seq,
      error,
    });
  }
}

interface Props {
  msg: WsMessage;
  onAnswer?: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti?: (ask_id: string, choice_ids: Record<string, string>) => void;
  typewriter?: boolean;
  forceComplete?: boolean;
  waiting?: boolean;
  imageUri?: string;
  serverUrl?: string;
  token?: string;
}

export const MessageBubble = memo(function MessageBubble({
  msg,
  onAnswer,
  onAnswerMulti,
  typewriter = false,
  forceComplete = false,
  waiting = false,
  imageUri,
  serverUrl = '',
  token = '',
}: Props) {
  const agentText = msg.role === 'agent_text' ? ((msg.payload as AgentTextPayload).text ?? '') : '';
  const agentUnits = useMemo(() => graphemeUnits(agentText), [agentText]);
  const agentUnitCount = agentUnits.length;
  const [visibleUnits, setVisibleUnits] = useState(typewriter ? 0 : agentUnitCount);
  const prevTypewriterRef = useRef(typewriter);
  const prevAgentTextRef = useRef(agentText);
  const prevAgentSeqRef = useRef(msg.seq);
  const visibleUnitsRef = useRef(typewriter ? 0 : agentUnitCount);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    function setRevealCount(count: number) {
      visibleUnitsRef.current = count;
      setVisibleUnits(count);
    }

    if (!typewriter || forceComplete || msg.role !== 'agent_text') {
      setRevealCount(agentUnitCount);
      prevAgentTextRef.current = agentText;
      prevAgentSeqRef.current = msg.seq;
      return undefined;
    }

    const replacesMessage =
      msg.seq !== prevAgentSeqRef.current || !agentText.startsWith(prevAgentTextRef.current);
    if (!prevTypewriterRef.current || replacesMessage || visibleUnitsRef.current > agentUnitCount) {
      setRevealCount(0);
    }
    prevAgentTextRef.current = agentText;
    prevAgentSeqRef.current = msg.seq;

    const timer = setInterval(() => {
      setVisibleUnits((count: number) => {
        const safeCount = Math.min(count, agentUnitCount);
        if (safeCount >= agentUnitCount) {
          clearInterval(timer);
          visibleUnitsRef.current = safeCount;
          return safeCount;
        }
        const next = Math.min(nextTypewriterCount(agentUnits, safeCount), agentUnitCount);
        visibleUnitsRef.current = next;
        return next;
      });
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [agentText, agentUnits, agentUnitCount, forceComplete, msg.role, msg.seq, typewriter]);

  useEffect(() => {
    prevTypewriterRef.current = typewriter;
  });

  useEffect(() => {
    setImageLoadFailed(false);
  }, [imageUri]);

  const markImageLoadFailed = React.useCallback(() => {
    if (msg.role === 'user_text') {
      const payload = msg.payload as UserTextPayload;
      recordDiagnosticsEvent('warn', 'chat.image', 'image load failed', {
        file_id: payload.file_id,
        uri: imageUri,
        seq: msg.seq,
      });
      if (imageUri) void probeFailedImageUri(imageUri, payload.file_id, msg.seq);
    }
    setImageLoadFailed(true);
  }, [imageUri, msg]);

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
          {hasImage && imageUri && !imageLoadFailed ? (
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
                  <X size={18} color={brandColors.white} />
                </Pressable>
                <Image
                  source={{ uri: imageUri }}
                  style={s.previewImage}
                  resizeMode="contain"
                  onError={markImageLoadFailed}
                />
                <Text style={s.previewFilename}>{payload.file_id}</Text>
              </View>
            </Modal>
          ) : null}
          <View style={s.userBubble}>
            {hasImage ? (
              imageUri && !imageLoadFailed ? (
                <Pressable testID="user-image-thumb" onPress={() => setPreviewVisible(true)}>
                  <Image
                    testID="user-image"
                    source={{ uri: imageUri }}
                    style={s.thumbImage}
                    resizeMode="cover"
                    onError={markImageLoadFailed}
                  />
                </Pressable>
              ) : (
                <Text testID="user-image-placeholder" style={s.attachmentPlaceholder}>
                  {imageLoadFailed ? 'Image unavailable' : '📎 Image'}
                </Text>
              )
            ) : null}
            {payload.text ? (
              <Text selectable style={[s.userText, hasImage ? s.imageCaption : null]}>
                {payload.text}
              </Text>
            ) : null}
            {hasImage && imageUri && !imageLoadFailed ? (
              <Text style={s.enlargeHint}>Tap to enlarge →</Text>
            ) : null}
          </View>
        </View>
      );
    }

    case 'agent_text': {
      const isStreaming = typewriter && !forceComplete && visibleUnits < agentUnitCount;
      const displayedText = isStreaming ? `${joinUnits(agentUnits, visibleUnits)}▌` : agentText;

      if (isStreaming) {
        return (
          <View style={s.aiWrap}>
            <View testID="agent-text-bubble" style={s.aiBubble}>
              <Text selectable style={s.aiText}>
                {displayedText}
              </Text>
            </View>
          </View>
        );
      }
      return (
        <View style={s.aiWrap}>
          <View testID="agent-text-bubble" style={s.aiBubble}>
            <MarkdownMessage content={agentText} serverUrl={serverUrl} token={token} />
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

    case 'system_event': {
      const payload = msg.payload as SystemEventPayload;
      if (payload.event !== 'model_changed') return null;
      return (
        <View style={s.systemEventWrap}>
          <Text style={s.systemEventText}>
            {`Model changed: ${payload.from_label} -> ${payload.to_label}`}
          </Text>
        </View>
      );
    }

    default:
      return null;
  }
});

const s = StyleSheet.create({
  userWrap: { width: '100%', alignItems: 'flex-end' },
  aiWrap: { width: '100%', alignItems: 'flex-start' },
  userBubble: {
    maxWidth: 312,
    backgroundColor: brandRgba.cyanWash,
    borderWidth: 1,
    borderColor: brandColors.cyan,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  aiBubble: {
    width: '100%',
    backgroundColor: brandColors.white,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  waitingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
    width: 64,
  },
  analyzingText: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.textMuted,
    letterSpacing: 0.5,
    marginTop: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: brandColors.textMuted },
  userText: { fontFamily: 'Inter', fontSize: 15, color: brandColors.ink, lineHeight: 22 },
  aiText: { fontFamily: 'Inter', fontSize: 15, color: brandColors.ink, lineHeight: 22 },
  thumbImage: { width: 120, height: 120, borderRadius: 8, marginBottom: 4 },
  attachmentPlaceholder: { fontFamily: 'Inter', fontSize: 12, color: brandColors.ink, marginBottom: 4 },
  imageCaption: { marginTop: 4 },
  enlargeHint: { fontFamily: 'Inter', fontSize: 10, color: brandColors.textSoft, marginTop: 4 },
  fullscreenClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: brandColors.darkPanel,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  previewFilename: { fontFamily: 'Inter', fontSize: 11, color: brandColors.silver, marginTop: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: brandRgba.ink72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: { width: '100%', height: '80%' },
  systemEventWrap: { width: '100%', alignItems: 'center', paddingVertical: 4 },
  systemEventText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textSoft,
    backgroundColor: brandRgba.white70,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});

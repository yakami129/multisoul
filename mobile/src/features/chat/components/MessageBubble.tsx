import { X } from 'lucide-react-native';
import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text, StyleSheet, Image, Modal, Pressable } from 'react-native';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import {
  type WsMessage,
  type AskQuestionPayload,
  type AgentTextPayload,
  type UserTextPayload,
  type ToolCallPayload,
} from '@/types';
import AskQuestionCard from './AskQuestionCard';
import { MarkdownMessage } from './MarkdownMessage';
import MultiAskQuestionCard from './MultiAskQuestionCard';
import { ToolCallRow } from './ToolCallRow';

const TYPEWRITER_INTERVAL_MS = 18;
const DOT_PULSE_DURATION = 600;

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
  const [visibleChars, setVisibleChars] = useState(typewriter ? 0 : agentText.length);
  const prevTypewriterRef = useRef(typewriter);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (!typewriter || msg.role !== 'agent_text') {
      // Also handles typewriter=false (natural end / forceComplete): jumps visibleChars to end.
      // Note: setting typewriter=false also triggers this effect and jumps visibleChars to end.
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
                  <X size={18} color="#FFFFFF" />
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
      // forceComplete bypasses typewriter even if typewriter prop is still true.
      // This handles the case when a tool_call arrives or conversation completes
      // mid-typewriter — the parent computes this synchronously (no setState race).
      const isStreaming = typewriter && !forceComplete && visibleChars < agentText.length;
      const displayedText = isStreaming ? `${agentText.slice(0, visibleChars)}▌` : agentText;

      if (isStreaming) {
        return (
          <View style={s.aiWrap}>
            <View testID="agent-text-bubble" style={s.aiBubble}>
              <Text selectable style={[s.aiText, s.typingText]}>
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
    maxWidth: 280,
    backgroundColor: '#FF6B35',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    padding: 14,
  },
  aiBubble: {
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    padding: 14,
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
    color: '#888888',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#888888' },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: 64,
    gap: 6,
  },
  userText: { fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  aiText: { fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  typingText: { color: '#FFFFFF' },
  waitingText: { fontFamily: 'Inter', fontSize: 14, color: '#888888', lineHeight: 20 },
  waitingTextWrap: { overflow: 'hidden', position: 'relative', width: 112 },
  waitingShine: { position: 'absolute', top: 0, bottom: 0, width: 48, overflow: 'hidden' },
  waitingTextHighlight: { color: '#FFFFFF', width: 112 },
  thumbImage: { width: 120, height: 120, borderRadius: 8, marginBottom: 4 },
  attachmentPlaceholder: { fontFamily: 'Inter', fontSize: 12, color: '#FFFFFF', marginBottom: 4 },
  imageCaption: { marginTop: 4 },
  enlargeHint: { fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  fullscreenClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  previewFilename: { fontFamily: 'Inter', fontSize: 11, color: '#888888', marginTop: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: { width: '100%', height: '80%' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  statusLine: { flex: 1, height: 1 },
  statusText: { fontFamily: 'Inter', fontSize: 11, letterSpacing: 1 },
});

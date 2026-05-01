import { Bot, Info } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';

const CUSTOM_ID = '__custom__';

interface QuestionItem {
  id: string;
  text: string;
  options: { id: string; label: string }[];
}

interface Props {
  questions: QuestionItem[];
  answered?: boolean;
  initialAnswers?: Record<string, string>;
  onCancel: () => void;
  onConfirm: (answers: Record<string, string>) => void;
}

export default function MultiAskQuestionCard({
  questions,
  answered: answeredProp = false,
  initialAnswers,
  onCancel,
  onConfirm,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState(answeredProp);

  const total = questions.length;
  // currentIndex = number of questions answered so far (with valid answers)
  const currentIndex = questions.filter((q) => {
    const ans = answers[q.id];
    if (!ans) return false;
    if (ans === CUSTOM_ID) return (customTexts[q.id]?.trim().length ?? 0) > 0;
    return true;
  }).length;
  const allAnswered = currentIndex >= total;
  const progressWidth = total > 0 ? (currentIndex / total) * 100 : 0;

  const handleSelect = (questionId: string, optionId: string) => {
    if (answered) return;
    if (optionId === CUSTOM_ID) {
      // Select Other but don't advance yet — wait for text input
      setAnswers((prev) => ({ ...prev, [questionId]: CUSTOM_ID }));
    } else {
      setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    }
  };

  const handleCustomText = (questionId: string, text: string) => {
    setCustomTexts((prev) => ({ ...prev, [questionId]: text }));
    // Store the typed text as the answer so the card advances once text is non-empty
    if (text.trim()) {
      setAnswers((prev) => ({ ...prev, [questionId]: CUSTOM_ID }));
    }
  };

  const handleConfirm = () => {
    if (!allAnswered || answered) return;
    setAnswered(true);
    const resolved: Record<string, string> = {};
    for (const q of questions) {
      const raw = answers[q.id];
      resolved[q.id] = raw === CUSTOM_ID ? (customTexts[q.id]?.trim() ?? '') : raw;
    }
    onConfirm(resolved);
  };

  const handleCancel = () => {
    if (answered) return;
    setAnswered(true);
    onCancel();
  };

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Bot size={16} color="#20C20E" />
          <Text style={s.headerLabel}>{answered ? 'ANSWERED' : 'AGENT IS ASKING'}</Text>
        </View>
        <View style={s.headerRight}>
          <Text style={s.progress}>
            {currentIndex} / {total}
          </Text>
          <Info size={16} color="#2D8B2D" />
        </View>
      </View>

      {/* Progress bar */}
      <View style={s.progressBarBg}>
        <View style={[s.progressBarFill, { width: `${progressWidth}%` as `${number}%` }]} />
      </View>

      {/* Questions */}
      <View style={s.body}>
        {questions.map((q, idx) => {
          const isActive = !answered && idx === currentIndex;
          const isDone = idx < currentIndex;
          const opacity = answered ? 0.6 : isActive ? 1 : isDone ? 0.7 : 0.4;
          const selectedOptId = answers[q.id];

          return (
            <View
              key={`${q.id}-${idx}`}
              style={[s.section, idx < questions.length - 1 && s.sectionBorder, { opacity }]}
            >
              <View style={s.qHeader}>
                <Bot size={14} color="#20C20E" />
                <Text style={s.qText}>
                  Q{idx + 1}: {q.text}
                </Text>
              </View>

              {/* Show options only for active question; show selected option for done questions */}
              {isActive && (
                <View style={s.opts}>
                  {[...q.options, { id: CUSTOM_ID, label: 'Other' }].map((opt, optIndex) => {
                    const selected = selectedOptId === opt.id;
                    const isCustomRow = opt.id === CUSTOM_ID;
                    return (
                      <TouchableOpacity
                        key={`${q.id}-${opt.id}-${optIndex}`}
                        accessibilityLabel={opt.label}
                        style={[s.opt, selected && s.optSelected]}
                        onPress={() => handleSelect(q.id, opt.id)}
                        activeOpacity={0.7}
                      >
                        <View style={[s.radio, selected && s.radioSelected]} />
                        {isCustomRow && selected ? (
                          <TextInput
                            style={s.customInput}
                            placeholder="Type your answer..."
                            placeholderTextColor="#0F6B0F"
                            value={customTexts[q.id] ?? ''}
                            onChangeText={(text) => handleCustomText(q.id, text)}
                            maxLength={200}
                            autoFocus
                          />
                        ) : (
                          <Text style={s.optLabel}>{opt.label}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {isDone && selectedOptId != null && (
                <View style={s.opts}>
                  {selectedOptId === CUSTOM_ID ? (
                    <View style={[s.opt, s.optSelected]}>
                      <View style={[s.radio, s.radioSelected]} />
                      <Text style={s.optLabel}>{customTexts[q.id] ?? 'Other'}</Text>
                    </View>
                  ) : (
                    q.options
                      .filter((opt) => opt.id === selectedOptId)
                      .map((opt, optIndex) => (
                        <View
                          key={`${q.id}-${opt.id}-selected-${optIndex}`}
                          style={[s.opt, s.optSelected]}
                        >
                          <View style={[s.radio, s.radioSelected]} />
                          <Text style={s.optLabel}>{opt.label}</Text>
                        </View>
                      ))
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Actions — hidden after answered */}
      {!answered && (
        <View style={s.actions}>
          <TouchableOpacity accessibilityLabel="Cancel" style={s.cancelBtn} onPress={handleCancel}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Confirm"
            style={[s.confirmBtn, !allAnswered && s.confirmBtnDisabled]}
            onPress={handleConfirm}
          >
            <Text style={s.confirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#061206',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    width: 320,
    overflow: 'hidden',
  },
  header: {
    height: 44,
    backgroundColor: '#0A1A0A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#2D8B2D',
    letterSpacing: 1.5,
  },
  progress: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#2D8B2D',
  },
  progressBarBg: {
    height: 2,
    backgroundColor: '#0A1A0A',
  },
  progressBarFill: {
    height: 2,
    backgroundColor: '#20C20E',
  },
  body: {
    // sections handle their own padding
  },
  section: {
    paddingVertical: 4,
  },
  sectionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  qHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 14,
    gap: 8,
    backgroundColor: '#040D04',
  },
  qText: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#20C20E',
    flex: 1,
  },
  opts: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 8,
    gap: 6,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 6,
    backgroundColor: '#040D04',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 12,
    gap: 10,
  },
  optSelected: {
    borderColor: '#33FF33',
    backgroundColor: '#0F2B0F',
  },
  radio: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#2D8B2D',
  },
  radioSelected: {
    borderColor: '#33FF33',
    backgroundColor: '#33FF33',
  },
  optLabel: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#20C20E',
  },
  customInput: {
    flex: 1,
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#20C20E',
    paddingVertical: 0,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#0F2B0F',
  },
  cancelBtn: {
    flex: 1,
    height: 36,
    borderRadius: 4,
    backgroundColor: '#040D04',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#2D8B2D',
    letterSpacing: 1,
  },
  confirmBtn: {
    flex: 1,
    height: 36,
    borderRadius: 4,
    backgroundColor: '#20C20E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: '#040D04',
    letterSpacing: 1,
  },
});

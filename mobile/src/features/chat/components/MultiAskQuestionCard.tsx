import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Bot } from 'lucide-react-native';

interface QuestionOption {
  id: string;
  label: string;
}

interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
}

interface Props {
  questions: Question[];
  onCancel: () => void;
  onConfirm: (answers: Record<string, string>) => void;
}

export default function MultiAskQuestionCard({ questions, onCancel, onConfirm }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const currentIndex = Object.keys(answers).length;
  const total = questions.length;

  const handleSelect = (questionId: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  };

  const progressWidth = total > 0 ? (currentIndex / total) * 100 : 0;

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Bot size={16} color="#20C20E" />
          <Text style={s.headerLabel}>AGENT IS ASKING</Text>
        </View>
        <Text style={s.progress}>{currentIndex} / {total}</Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressBarBg}>
        <View style={[s.progressBarFill, { width: `${progressWidth}%` as any }]} />
      </View>

      {/* Questions */}
      <View style={s.body}>
        {questions.map((q, idx) => {
          const isActive = idx === currentIndex;
          const isDone = idx < currentIndex;
          const opacity = isActive ? 1 : isDone ? 0.7 : 0.4;

          return (
            <View
              key={q.id}
              style={[
                s.section,
                idx < questions.length - 1 && s.sectionBorder,
                { opacity },
              ]}
            >
              <View style={s.qHeader}>
                <Bot size={14} color="#20C20E" />
                <Text style={s.qText}>
                  Q{idx + 1}: {q.text}
                </Text>
              </View>
              {isActive && (
                <View style={s.opts}>
                  {q.options.map((opt) => {
                    const selected = answers[q.id] === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        style={[s.opt, selected && s.optSelected]}
                        onPress={() => handleSelect(q.id, opt.id)}
                      >
                        <View style={[s.radio, selected && s.radioSelected]} />
                        <Text style={s.optLabel}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
          <Text style={s.cancelText}>CANCEL</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.confirmBtn, currentIndex < total && s.confirmBtnDisabled]}
          onPress={() => currentIndex >= total && onConfirm(answers)}
        >
          <Text style={s.confirmText}>CONFIRM</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#061206',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    width: 342,
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
    height: 4,
    backgroundColor: '#0A1A0A',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: '#20C20E',
  },
  body: {
    // no padding, sections handle their own
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
    gap: 6,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 4,
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 14,
    gap: 10,
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
    backgroundColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700',
    color: '#2D8B2D',
    letterSpacing: 1,
  },
});

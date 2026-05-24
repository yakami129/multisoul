import { Bot, Info } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';

const CUSTOM_ID = '__custom__';

interface QuestionItem {
  id: string;
  text: string;
  options: { id: string; label: string }[];
  multi_select?: boolean;
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
  const initialCustomTexts: Record<string, string> = {};
  const normalizedInitialAnswers: Record<string, string | Set<string>> = Object.fromEntries(
    Object.entries(initialAnswers ?? {}).map(
      ([questionId, answer]): [string, string | Set<string>] => {
        const question = questions.find((q) => q.id === questionId);
        const isMulti = question?.multi_select ?? false;

        if (isMulti) {
          // 多选：逗号分隔字符串 → Set
          const ids = answer
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          return [questionId, new Set(ids)];
        } else {
          // 单选：保持字符串
          const isKnownOption = question?.options.some((option) => option.id === answer) ?? false;
          if (!isKnownOption) {
            initialCustomTexts[questionId] = answer;
            return [questionId, CUSTOM_ID];
          }
          return [questionId, answer];
        }
      },
    ),
  );
  const [answers, setAnswers] =
    useState<Record<string, string | Set<string>>>(normalizedInitialAnswers);
  const [customTexts, setCustomTexts] = useState<Record<string, string>>(initialCustomTexts);
  const [committedCustomTexts, setCommittedCustomTexts] =
    useState<Record<string, string>>(initialCustomTexts);
  const [activeIndex, setActiveIndex] = useState(0);
  const answered = answeredProp;

  const total = questions.length;
  const answeredCount = questions.filter((q) => {
    const ans = answers[q.id];
    if (!ans) return false;

    if (ans instanceof Set) {
      // 多选：至少选一个，且如果选了 CUSTOM_ID 则必须有自定义文本
      if (ans.size === 0) return false;
      if (ans.has(CUSTOM_ID)) {
        return (committedCustomTexts[q.id]?.length ?? 0) > 0;
      }
      return true;
    } else {
      // 单选：有选项，且如果是 CUSTOM_ID 则必须有自定义文本
      if (ans === CUSTOM_ID) {
        return (committedCustomTexts[q.id]?.length ?? 0) > 0;
      }
      return true;
    }
  }).length;
  const allAnswered = answeredCount >= total;
  const progressWidth = total > 0 ? (answeredCount / total) * 100 : 0;

  const getNextOpenIndex = (
    nextAnswers: Record<string, string | Set<string>>,
    startIndex: number,
  ) => {
    for (let i = startIndex; i < questions.length; i += 1) {
      if (!nextAnswers[questions[i].id]) return i;
    }
    for (let i = 0; i < startIndex; i += 1) {
      if (!nextAnswers[questions[i].id]) return i;
    }
    return questions.length;
  };

  const handleSelect = (questionId: string, optionId: string) => {
    if (answered) return;

    const question = questions.find((q) => q.id === questionId);
    const isMulti = question?.multi_select ?? false;

    if (optionId === CUSTOM_ID) {
      // Custom 选项：清空已提交的自定义文本
      setAnswers((prev) => ({
        ...prev,
        [questionId]: isMulti ? new Set([CUSTOM_ID]) : CUSTOM_ID,
      }));
      setCommittedCustomTexts((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    } else if (isMulti) {
      // 多选：toggle 选项
      setAnswers((prev) => {
        const current = prev[questionId];
        const currentSet = current instanceof Set ? current : new Set<string>();
        const next = new Set(currentSet);

        if (next.has(optionId)) {
          next.delete(optionId);
        } else {
          next.add(optionId);
        }

        // 如果选了其他选项，移除 CUSTOM_ID
        if (next.size > 0 && next.has(CUSTOM_ID) && optionId !== CUSTOM_ID) {
          next.delete(CUSTOM_ID);
        }

        return { ...prev, [questionId]: next };
      });
    } else {
      // 单选：替换选项，自动跳转下一题
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: optionId };
        setActiveIndex(getNextOpenIndex(next, activeIndex + 1));
        return next;
      });
    }
  };

  const handleCustomText = (questionId: string, text: string) => {
    setCustomTexts((prev) => ({ ...prev, [questionId]: text }));
    setCommittedCustomTexts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  const handleCommitCustomText = (questionId: string) => {
    const text = customTexts[questionId]?.trim() ?? '';
    if (!text) return;
    setCommittedCustomTexts((prev) => ({ ...prev, [questionId]: text }));

    const question = questions.find((q) => q.id === questionId);
    const isMulti = question?.multi_select ?? false;

    setAnswers((prev) => {
      const next = { ...prev, [questionId]: isMulti ? new Set([CUSTOM_ID]) : CUSTOM_ID };
      setActiveIndex(getNextOpenIndex(next, activeIndex + 1));
      return next;
    });
  };

  const handleEdit = (index: number) => {
    if (answered) return;
    setActiveIndex(index);
  };

  const handleConfirm = () => {
    if (!allAnswered || answered) return;
    const resolved: Record<string, string> = {};
    for (const q of questions) {
      const raw = answers[q.id];
      if (raw === CUSTOM_ID) {
        resolved[q.id] = committedCustomTexts[q.id] ?? '';
      } else if (raw instanceof Set) {
        // 多选：Set → 逗号分隔字符串
        resolved[q.id] = Array.from(raw).join(',');
      } else {
        // 单选：直接使用字符串
        resolved[q.id] = raw;
      }
    }
    onConfirm(resolved);
  };

  const handleCancel = () => {
    if (answered) return;
    onCancel();
  };

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Bot size={16} color="#FF6B35" />
          <Text style={s.headerLabel}>{answered ? 'ANSWERED' : 'AGENT IS ASKING'}</Text>
        </View>
        <View style={s.headerRight}>
          <Text style={s.progress}>
            {answeredCount} / {total}
          </Text>
          <Info size={16} color="#555555" />
        </View>
      </View>

      {/* Progress bar */}
      <View style={s.progressBarBg}>
        <View style={[s.progressBarFill, { width: `${progressWidth}%` as `${number}%` }]} />
      </View>

      {/* Questions */}
      <View style={s.body}>
        {questions.map((q, idx) => {
          const selectedOptId = answers[q.id];
          const hasAnswer =
            selectedOptId === CUSTOM_ID
              ? (committedCustomTexts[q.id]?.length ?? 0) > 0
              : selectedOptId != null;
          const isActive = !answered && idx === activeIndex;
          const isDone = hasAnswer && !isActive;
          const opacity = answered ? 0.6 : isActive ? 1 : isDone ? 0.7 : 0.4;

          return (
            <View
              key={`${q.id}-${idx}`}
              style={[s.section, idx < questions.length - 1 && s.sectionBorder, { opacity }]}
            >
              <View style={s.qHeader}>
                <Bot size={14} color="#FF6B35" />
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
                          <View style={s.customEditor}>
                            <TextInput
                              style={s.customInput}
                              placeholder="Type your answer..."
                              placeholderTextColor="#555555"
                              value={customTexts[q.id] ?? ''}
                              onChangeText={(text) => handleCustomText(q.id, text)}
                              maxLength={200}
                              autoFocus
                            />
                            <TouchableOpacity
                              accessibilityLabel="Use answer"
                              accessibilityState={{
                                disabled: (customTexts[q.id]?.trim().length ?? 0) === 0,
                              }}
                              style={[
                                s.useAnswerBtn,
                                (customTexts[q.id]?.trim().length ?? 0) === 0 && s.useAnswerBtnOff,
                              ]}
                              onPress={() => handleCommitCustomText(q.id)}
                            >
                              <Text style={s.useAnswerText}>Use</Text>
                            </TouchableOpacity>
                          </View>
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
                      <Text style={s.optLabel}>{committedCustomTexts[q.id] ?? 'Other'}</Text>
                      {!answered && (
                        <TouchableOpacity
                          accessibilityLabel={`Edit ${q.id}`}
                          style={s.editBtn}
                          onPress={() => handleEdit(idx)}
                        >
                          <Text style={s.editText}>Edit</Text>
                        </TouchableOpacity>
                      )}
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
                          {!answered && (
                            <TouchableOpacity
                              accessibilityLabel={`Edit ${q.id}`}
                              style={s.editBtn}
                              onPress={() => handleEdit(idx)}
                            >
                              <Text style={s.editText}>Edit</Text>
                            </TouchableOpacity>
                          )}
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
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FF6B35',
    width: 320,
    overflow: 'hidden',
  },
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLabel: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: '#FF6B35' },
  progress: { fontFamily: 'Inter', fontSize: 12, color: '#666666' },
  progressBarBg: { height: 3, backgroundColor: '#252525' },
  progressBarFill: { height: 3, backgroundColor: '#FF6B35' },
  body: {},
  section: { paddingVertical: 4 },
  sectionBorder: { borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  qHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 14,
    gap: 8,
  },
  qText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF', flex: 1 },
  opts: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 8, gap: 6 },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 8,
    backgroundColor: '#252525',
    paddingHorizontal: 12,
    gap: 10,
  },
  optSelected: { borderWidth: 1, borderColor: '#4CAF50', backgroundColor: '#1F2A1F' },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#555555',
    backgroundColor: '#252525',
  },
  radioSelected: { borderColor: '#4CAF50', backgroundColor: '#4CAF50' },
  optLabel: { fontFamily: 'Inter', fontSize: 14, color: '#DDDDDD' },
  customEditor: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  customInput: { flex: 1, fontFamily: 'Inter', fontSize: 13, color: '#FFFFFF', paddingVertical: 0 },
  useAnswerBtn: {
    height: 26,
    borderRadius: 6,
    backgroundColor: '#FF6B35',
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useAnswerBtnOff: { opacity: 0.4 },
  useAnswerText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  editBtn: {
    marginLeft: 'auto',
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#555555',
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#888888' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#252525',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '500', color: '#888888' },
  confirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});

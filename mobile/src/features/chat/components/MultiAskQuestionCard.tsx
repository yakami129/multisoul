import { Bot, Info } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import QuestionOption from './QuestionOption';
import SelectedOption from './SelectedOption';

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

  const isQuestionAnswered = (
    question: QuestionItem,
    nextAnswers: Record<string, string | Set<string>>,
  ) => {
    const ans = nextAnswers[question.id];
    if (!ans) return false;

    if (ans instanceof Set) {
      if (ans.size === 0) return false;
      if (ans.has(CUSTOM_ID)) {
        return (committedCustomTexts[question.id]?.length ?? 0) > 0;
      }
      return true;
    }

    if (ans === CUSTOM_ID) {
      return (committedCustomTexts[question.id]?.length ?? 0) > 0;
    }
    return true;
  };

  const total = questions.length;
  const answeredCount = questions.filter((q) => isQuestionAnswered(q, answers)).length;
  const allAnswered = answeredCount >= total;
  const progressWidth = total > 0 ? (answeredCount / total) * 100 : 0;
  const activeQuestion = questions[activeIndex];
  const activeQuestionAnswered = activeQuestion
    ? isQuestionAnswered(activeQuestion, answers)
    : false;
  const showNext =
    !answered &&
    !!activeQuestion?.multi_select &&
    activeQuestionAnswered &&
    !allAnswered &&
    activeIndex < questions.length;

  const getNextOpenIndex = (
    nextAnswers: Record<string, string | Set<string>>,
    startIndex: number,
  ) => {
    for (let i = startIndex; i < questions.length; i += 1) {
      if (!isQuestionAnswered(questions[i], nextAnswers)) return i;
    }
    for (let i = 0; i < startIndex; i += 1) {
      if (!isQuestionAnswered(questions[i], nextAnswers)) return i;
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

      if (raw instanceof Set) {
        // 多选：Set → 逗号分隔字符串
        const ids = Array.from(raw)
          .filter((id) => id !== CUSTOM_ID)
          .sort();
        const customText = raw.has(CUSTOM_ID) ? committedCustomTexts[q.id] : undefined;
        const parts = customText ? [...ids, customText] : ids;
        resolved[q.id] = parts.join(',');
      } else {
        // 单选：直接使用或替换为自定义文本
        resolved[q.id] = raw === CUSTOM_ID ? (committedCustomTexts[q.id] ?? '') : raw;
      }
    }

    onConfirm(resolved);
  };

  const handleCancel = () => {
    if (answered) return;
    onCancel();
  };

  const handleNext = () => {
    if (!showNext) return;
    setActiveIndex(getNextOpenIndex(answers, activeIndex + 1));
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
          const hasAnswer = isQuestionAnswered(q, answers);
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
                    const ans = answers[q.id];
                    const isMulti = q.multi_select ?? false;
                    const selected = isMulti
                      ? ans instanceof Set && ans.has(opt.id)
                      : ans === opt.id;
                    return (
                      <QuestionOption
                        key={`${q.id}-${opt.id}-${optIndex}`}
                        option={opt}
                        questionId={q.id}
                        isMulti={isMulti}
                        selected={selected}
                        answered={false}
                        customText={customTexts[q.id] ?? ''}
                        onSelect={handleSelect}
                        onCustomTextChange={handleCustomText}
                        onCommitCustomText={handleCommitCustomText}
                      />
                    );
                  })}
                </View>
              )}

              {isActive && q.multi_select && showNext && (
                <View style={s.nextRow}>
                  <TouchableOpacity
                    accessibilityLabel="Next"
                    style={s.nextBtn}
                    onPress={handleNext}
                  >
                    <Text style={s.nextText}>Next</Text>
                  </TouchableOpacity>
                </View>
              )}

              {isDone && selectedOptId != null && (
                <View style={s.opts}>
                  {(() => {
                    const ans = answers[q.id];
                    const isMulti = q.multi_select ?? false;

                    if (isMulti && ans instanceof Set) {
                      // Multi-select: show all selected options
                      const selectedIds = Array.from(ans);
                      return selectedIds.map((optId, optIndex) => {
                        if (optId === CUSTOM_ID) {
                          return (
                            <SelectedOption
                              key={`${q.id}-${optId}-${optIndex}`}
                              label={committedCustomTexts[q.id] ?? 'Other'}
                              isMulti={true}
                              answered={answered}
                              showEdit={true}
                              onEdit={() => handleEdit(idx)}
                            />
                          );
                        }
                        const opt = q.options.find((o) => o.id === optId);
                        if (!opt) return null;
                        return (
                          <SelectedOption
                            key={`${q.id}-${opt.id}-${optIndex}`}
                            label={opt.label}
                            isMulti={true}
                            answered={answered}
                            showEdit={optIndex === selectedIds.length - 1}
                            onEdit={() => handleEdit(idx)}
                          />
                        );
                      });
                    }

                    // Single-select: show the one selected option
                    if (selectedOptId === CUSTOM_ID) {
                      return (
                        <SelectedOption
                          label={committedCustomTexts[q.id] ?? 'Other'}
                          isMulti={false}
                          answered={answered}
                          showEdit={true}
                          onEdit={() => handleEdit(idx)}
                        />
                      );
                    }
                    return q.options
                      .filter((opt) => opt.id === selectedOptId)
                      .map((opt, optIndex) => (
                        <SelectedOption
                          key={`${q.id}-${opt.id}-selected-${optIndex}`}
                          label={opt.label}
                          isMulti={false}
                          answered={answered}
                          showEdit={true}
                          onEdit={() => handleEdit(idx)}
                        />
                      ));
                  })()}
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
  nextRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  nextBtn: {
    height: 36,
    minWidth: 96,
    borderRadius: 10,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  nextText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
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

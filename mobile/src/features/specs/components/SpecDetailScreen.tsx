import { ChevronLeft, FileText } from 'lucide-react-native';
import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import {
  getFirstOpenQuestionId,
  isSpecInterviewReady,
  SPEC_INTERVIEW_QUESTIONS,
} from '../services/specInterview';
import { type SpecAnswer, type SpecDraft, type SpecQuestion } from '../types';

interface Props {
  spec: SpecDraft | undefined;
  onBack: () => void;
  onAnswer: (answer: SpecAnswer) => void;
  onGenerate: () => void;
  onApprove: () => void;
  onAskMore: () => void;
  onDispatch: () => void;
}

function statusLabel(status: SpecDraft['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'review':
      return 'Review';
    case 'approved':
      return 'Approved';
    case 'dispatching':
      return 'Dispatching';
    case 'dispatched':
      return 'Dispatched';
    case 'running':
      return 'Running';
    case 'blocked':
      return 'Blocked';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

export function SpecDetailScreen({
  spec,
  onBack,
  onAnswer,
  onGenerate,
  onApprove,
  onAskMore,
  onDispatch,
}: Props) {
  const insets = useSafeAreaInsets();
  const [otherText, setOtherText] = React.useState('');
  const openQuestionId = spec ? getFirstOpenQuestionId(spec.answers) : null;

  React.useEffect(() => {
    setOtherText('');
  }, [openQuestionId]);

  if (!spec) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header title="Spec" onBack={onBack} />
        <View style={s.centered}>
          <Text style={s.emptyTitle}>Spec not found</Text>
        </View>
      </View>
    );
  }

  const activeQuestion = SPEC_INTERVIEW_QUESTIONS.find(
    (question) => question.id === openQuestionId,
  );
  const ready = isSpecInterviewReady(spec.answers);
  const answeredCount = spec.answers.length;
  const totalCount = SPEC_INTERVIEW_QUESTIONS.length;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header title="Specs" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <View style={s.heroIcon}>
            <FileText size={18} color={brandColors.coral} />
          </View>
          <View style={s.heroBody}>
            <Text style={s.title}>{spec.title}</Text>
            <Text style={s.subtitle} numberOfLines={1}>
              {spec.targetRepoPath}
            </Text>
          </View>
          <Text style={s.status}>{statusLabel(spec.status)}</Text>
        </View>

        {spec.status === 'draft' ? (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardLabel}>SPEC BUILDER</Text>
              <Text style={s.progress}>
                {answeredCount} / {totalCount}
              </Text>
            </View>
            {activeQuestion ? (
              <>
                <Text style={s.question}>{activeQuestion.text}</Text>
                <View style={s.options}>
                  {activeQuestion.options.map((option) => (
                    <TouchableOpacity
                      key={option.id}
                      accessibilityRole="button"
                      onPress={() =>
                        onAnswer({
                          questionId: activeQuestion.id,
                          value: optionAnswerValue(spec, activeQuestion, option.label),
                          answeredAt: Date.now(),
                        })
                      }
                      style={[
                        s.option,
                        optionIsSelected(spec, activeQuestion, option.label) && s.optionSelected,
                      ]}
                    >
                      <Text style={s.optionText}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {activeQuestion.allowsOther ? (
                  <View style={s.otherRow}>
                    <TextInput
                      accessibilityLabel="Other answer"
                      value={otherText}
                      onChangeText={setOtherText}
                      placeholder="Other"
                      placeholderTextColor={brandColors.textDisabled}
                      style={s.otherInput}
                    />
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Add Other Answer"
                      accessibilityState={{ disabled: otherText.trim().length === 0 }}
                      disabled={otherText.trim().length === 0}
                      onPress={() => {
                        const value = otherAnswerValue(spec, activeQuestion, otherText);
                        if (!value) return;
                        onAnswer({
                          questionId: activeQuestion.id,
                          value,
                          answeredAt: Date.now(),
                        });
                        setOtherText('');
                      }}
                      style={[
                        s.otherButton,
                        otherText.trim().length === 0 && s.primaryButtonDisabled,
                      ]}
                    >
                      <Text style={s.primaryText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={s.question}>All required answers are ready.</Text>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Generate Spec"
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={onGenerate}
              style={[s.primaryButton, !ready && s.primaryButtonDisabled]}
            >
              <Text style={s.primaryText}>Generate Spec</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {spec.status === 'review' ? (
          <View style={s.card}>
            <Text style={s.cardLabel}>SPEC.MD PREVIEW</Text>
            <Text style={s.markdown}>{spec.markdownPreview}</Text>
            <View style={s.actions}>
              <TouchableOpacity style={s.secondaryButton} onPress={onAskMore}>
                <Text style={s.secondaryText}>Ask More</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.primaryButtonInline} onPress={onApprove}>
                <Text style={s.primaryText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {spec.status !== 'draft' && spec.status !== 'review' ? (
          <View style={s.card}>
            <Text style={s.cardLabel}>DISPATCH</Text>
            <Text style={s.question}>
              {spec.repoSpecPath
                ? `Repo file: ${spec.repoSpecPath}`
                : 'Ready to write this spec into the target repo.'}
            </Text>
            {spec.errorMessage ? <Text style={s.errorText}>{spec.errorMessage}</Text> : null}
            {spec.status === 'approved' || spec.status === 'failed' ? (
              <TouchableOpacity style={s.primaryButton} onPress={onDispatch}>
                <Text style={s.primaryText}>Dispatch</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function answerValues(spec: SpecDraft, questionId: string): string[] {
  const answer = spec.answers.find((item) => item.questionId === questionId);
  if (!answer) return [];
  if (Array.isArray(answer.value)) return answer.value;
  return answer.value.trim().length > 0 ? [answer.value] : [];
}

function optionAnswerValue(
  spec: SpecDraft,
  question: SpecQuestion,
  optionLabel: string,
): string | string[] {
  if (!question.multiSelect) return optionLabel;
  const current = answerValues(spec, question.id);
  if (current.includes(optionLabel)) {
    return current.filter((value) => value !== optionLabel);
  }
  return [...current, optionLabel];
}

function otherAnswerValue(
  spec: SpecDraft,
  question: SpecQuestion,
  otherText: string,
): string | string[] | null {
  const trimmed = otherText.trim();
  if (!trimmed) return null;
  if (!question.multiSelect) return trimmed;
  const current = answerValues(spec, question.id);
  return current.includes(trimmed) ? current : [...current, trimmed];
}

function optionIsSelected(spec: SpecDraft, question: SpecQuestion, optionLabel: string): boolean {
  return answerValues(spec, question.id).includes(optionLabel);
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={s.nav}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Back to Specs"
        onPress={onBack}
        style={s.backLink}
      >
        <ChevronLeft size={20} color={brandColors.ink} />
        <Text style={s.backText}>{title}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: brandColors.cream },
  nav: {
    height: 44,
    backgroundColor: brandColors.cream,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '700', color: brandColors.ink },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter', fontSize: 22, fontWeight: '800', color: brandColors.ink },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  hero: {
    minHeight: 78,
    borderRadius: 18,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: brandRgba.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'Inter', fontSize: 18, fontWeight: '800', color: brandColors.ink },
  subtitle: { marginTop: 4, fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  status: { fontFamily: 'Inter', fontSize: 12, fontWeight: '700', color: brandColors.coral },
  card: {
    borderRadius: 18,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    padding: 16,
    gap: 14,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontFamily: 'Inter', fontSize: 12, fontWeight: '700', color: brandColors.coral },
  progress: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  question: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '600',
    color: brandColors.ink,
    lineHeight: 22,
  },
  options: { gap: 8 },
  option: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: brandRgba.ink08,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  optionSelected: {
    backgroundColor: brandRgba.limeSoft,
    borderWidth: 1,
    borderColor: brandColors.lime,
  },
  optionText: { fontFamily: 'Inter', fontSize: 14, color: brandColors.ink },
  otherRow: { flexDirection: 'row', gap: 8 },
  otherInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: brandRgba.ink08,
    color: brandColors.ink,
    fontFamily: 'Inter',
    fontSize: 14,
    paddingHorizontal: 14,
  },
  otherButton: {
    width: 72,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: brandColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    height: 46,
    borderRadius: 10,
    backgroundColor: brandColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '700', color: brandColors.white },
  markdown: { fontFamily: 'Inter', fontSize: 13, lineHeight: 20, color: brandColors.ink },
  actions: { flexDirection: 'row', gap: 10 },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: brandRgba.ink08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '700', color: brandColors.ink },
  primaryButtonInline: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: brandColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { fontFamily: 'Inter', fontSize: 13, color: brandColors.error },
});

import { Bot, Info } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type AskQuestionOption } from '../types';

const CUSTOM_ID = '__custom__';

interface Props {
  question: string;
  subtitle?: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
  answered?: boolean;
  initialSelectedId?: string;
  initialSelectedIds?: Set<string>;
  onCancel: () => void;
  onConfirm: (selectedId: string) => void;
}

export default function AskQuestionCard({
  question,
  subtitle,
  options,
  multiSelect = false,
  answered: answeredProp = false,
  initialSelectedId,
  initialSelectedIds,
  onCancel,
  onConfirm,
}: Props) {
  const initialSelectedIsCustom =
    initialSelectedId != null && !options.some((option) => option.id === initialSelectedId);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedIsCustom ? CUSTOM_ID : (initialSelectedId ?? null),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelectedIds ?? new Set());
  const answered = answeredProp;
  const [customText, setCustomText] = useState(initialSelectedIsCustom ? initialSelectedId : '');
  const [committedCustomText, setCommittedCustomText] = useState(
    initialSelectedIsCustom ? initialSelectedId : '',
  );

  const allOptions: AskQuestionOption[] = [...options, { id: CUSTOM_ID, label: 'Other' }];

  const isCustomSelected = multiSelect ? selectedIds.has(CUSTOM_ID) : selectedId === CUSTOM_ID;
  const customTextTrimmed = customText.trim();
  const isCustomCommitted =
    committedCustomText.length > 0 && committedCustomText === customTextTrimmed;
  const isReady = multiSelect
    ? selectedIds.size > 0 && (!selectedIds.has(CUSTOM_ID) || isCustomCommitted)
    : selectedId !== null && (selectedId !== CUSTOM_ID || isCustomCommitted);

  const handleToggle = (id: string) => {
    if (answered) return;
    if (id !== CUSTOM_ID) {
      setCommittedCustomText('');
    }
    if (multiSelect) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          if (id === CUSTOM_ID) {
            setCommittedCustomText('');
          }
        } else {
          next.add(id);
        }
        return next;
      });
    } else {
      setSelectedId(id);
    }
  };

  const handleConfirm = () => {
    if (!isReady || answered) return;
    if (multiSelect) {
      const ids = Array.from(selectedIds)
        .filter((id) => id !== CUSTOM_ID)
        .sort();
      const parts = isCustomCommitted ? [...ids, committedCustomText] : ids;
      onConfirm(parts.join(','));
    } else {
      onConfirm(selectedId === CUSTOM_ID ? committedCustomText : selectedId!);
    }
  };

  const handleCancel = () => {
    if (answered) return;
    onCancel();
  };

  const handleCustomTextChange = (text: string) => {
    setCustomText(text);
    setCommittedCustomText('');
  };

  const handleCommitCustomText = () => {
    if (!customTextTrimmed) return;
    setCommittedCustomText(customTextTrimmed);
  };

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Bot size={16} color={brandColors.coral} />
          <Text style={s.headerLabel}>{answered ? 'ANSWERED' : 'AGENT IS ASKING'}</Text>
        </View>
        <Info size={16} color={brandColors.textSoft} />
      </View>

      {/* Body */}
      <View style={s.body}>
        <Text style={s.question}>{question}</Text>
        {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        {multiSelect && <Text style={s.hint}>Select one or more</Text>}

        {/* Options */}
        <View style={s.optsList}>
          {allOptions.map((opt, index) => {
            const selected = multiSelect ? selectedIds.has(opt.id) : selectedId === opt.id;
            const isCustomRow = opt.id === CUSTOM_ID;
            return (
              <TouchableOpacity
                key={`${opt.id}-${index}`}
                accessibilityLabel={opt.label}
                style={[s.option, selected && s.optionSelected, answered && s.optionReadonly]}
                onPress={() => handleToggle(opt.id)}
                activeOpacity={answered ? 1 : 0.7}
              >
                {multiSelect ? (
                  <View style={[s.checkbox, selected && s.checkboxSelected]}>
                    {selected && <View style={s.checkboxTick} />}
                  </View>
                ) : (
                  <View style={[s.radio, selected && s.radioSelected]} />
                )}
                {isCustomRow && selected && !answered ? (
                  <View style={s.customEditor}>
                    <TextInput
                      style={s.customInput}
                      placeholder="Type your answer..."
                      placeholderTextColor={brandColors.textSoft}
                      value={customText}
                      onChangeText={handleCustomTextChange}
                      maxLength={200}
                      autoFocus
                    />
                    <TouchableOpacity
                      accessibilityLabel="Use answer"
                      accessibilityState={{ disabled: customTextTrimmed.length === 0 }}
                      style={[s.useAnswerBtn, customTextTrimmed.length === 0 && s.useAnswerBtnOff]}
                      onPress={handleCommitCustomText}
                    >
                      <Text style={s.useAnswerText}>Use</Text>
                    </TouchableOpacity>
                  </View>
                ) : isCustomRow && answered && isCustomSelected ? (
                  <Text style={s.optionLabel}>{committedCustomText || customText || 'Other'}</Text>
                ) : (
                  <Text style={[s.optionLabel, answered && !selected && s.optionLabelMuted]}>
                    {opt.label}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Actions — hidden after answer submitted */}
        {!answered && (
          <View style={s.actions}>
            <TouchableOpacity
              accessibilityLabel="Cancel"
              style={s.cancelBtn}
              onPress={handleCancel}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel="Confirm"
              accessibilityState={{ disabled: !isReady }}
              style={[s.confirmBtn, !isReady && s.confirmBtnDisabled]}
              onPress={handleConfirm}
            >
              <Text style={s.confirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: brandRgba.white88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: brandColors.coral,
    width: '100%',
    overflow: 'hidden',
  },
  header: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: brandRgba.ink12,
    backgroundColor: brandRgba.coralSoft,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLabel: {
    fontFamily: brandTypography.body,
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.coral,
  },
  body: { padding: 14, gap: 10 },
  question: {
    fontFamily: brandTypography.body,
    fontSize: 15,
    fontWeight: '700',
    color: brandColors.ink,
    lineHeight: 21,
  },
  subtitle: { fontFamily: brandTypography.body, fontSize: 12, color: brandColors.textSoft },
  hint: { fontFamily: brandTypography.body, fontSize: 12, color: brandColors.textMuted },
  optsList: { gap: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white70,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  optionSelected: { backgroundColor: brandRgba.limeSoft, borderColor: brandColors.lime },
  optionReadonly: { opacity: 0.6 },
  optionLabelMuted: { color: brandColors.textDisabled },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: brandColors.textSoft,
    backgroundColor: brandRgba.white70,
  },
  radioSelected: { borderColor: brandColors.lime, backgroundColor: brandColors.lime },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: brandColors.textSoft,
    backgroundColor: brandRgba.white70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { borderColor: brandColors.lime, backgroundColor: brandColors.lime },
  checkboxTick: { width: 8, height: 8, backgroundColor: brandColors.ink, borderRadius: 1 },
  optionLabel: { fontFamily: brandTypography.body, fontSize: 14, color: brandColors.ink },
  customEditor: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  customInput: {
    flex: 1,
    fontFamily: brandTypography.body,
    fontSize: 14,
    color: brandColors.ink,
    paddingVertical: 0,
  },
  useAnswerBtn: {
    height: 28,
    borderRadius: 6,
    backgroundColor: brandColors.lime,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useAnswerBtnOff: { opacity: 0.4 },
  useAnswerText: {
    fontFamily: brandTypography.body,
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.ink,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: brandRgba.ink12,
  },
  cancelBtn: {
    borderRadius: 10,
    backgroundColor: brandColors.coral,
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: brandTypography.body,
    fontSize: 14,
    fontWeight: '700',
    color: brandColors.white,
  },
  confirmBtn: {
    borderRadius: 10,
    backgroundColor: brandColors.lime,
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: {
    fontFamily: brandTypography.body,
    fontSize: 14,
    fontWeight: '700',
    color: brandColors.ink,
  },
});

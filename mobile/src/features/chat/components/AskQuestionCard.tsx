import { Bot, Info } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
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
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelectedIds ?? new Set());
  const [answered, setAnswered] = useState(answeredProp);
  const [customText, setCustomText] = useState('');
  const [committedCustomText, setCommittedCustomText] = useState('');

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
    setAnswered(true);
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
    setAnswered(true);
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
          <Bot size={16} color="#20C20E" />
          <Text style={s.headerLabel}>{answered ? 'ANSWERED' : 'AGENT IS ASKING'}</Text>
        </View>
        <Info size={16} color="#2D8B2D" />
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
                      placeholderTextColor="#0F6B0F"
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
  headerLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#2D8B2D',
    letterSpacing: 1.5,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  question: {
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '600',
    color: '#20C20E',
    lineHeight: 21,
  },
  subtitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: '#147A16',
  },
  hint: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: '#0F6B0F',
    letterSpacing: 0.5,
  },
  optsList: {
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 6,
    backgroundColor: '#040D04',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 14,
    gap: 12,
  },
  optionSelected: {
    backgroundColor: '#0F2B0F',
    borderColor: '#33FF33',
  },
  optionReadonly: {
    opacity: 0.6,
  },
  optionLabelMuted: {
    color: '#2D8B2D',
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#2D8B2D',
  },
  radioSelected: {
    borderColor: '#33FF33',
    backgroundColor: '#33FF33',
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#2D8B2D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: '#33FF33',
    backgroundColor: '#33FF33',
  },
  checkboxTick: {
    width: 8,
    height: 8,
    backgroundColor: '#040D04',
    borderRadius: 1,
  },
  optionLabel: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
  },
  customEditor: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customInput: {
    flex: 1,
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
    paddingVertical: 0,
  },
  useAnswerBtn: {
    height: 28,
    borderRadius: 4,
    backgroundColor: '#20C20E',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useAnswerBtnOff: {
    opacity: 0.4,
  },
  useAnswerText: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '700',
    color: '#040D04',
    letterSpacing: 0.5,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
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

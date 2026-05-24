import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';

const CUSTOM_ID = '__custom__';

interface Props {
  option: { id: string; label: string };
  questionId: string;
  isMulti: boolean;
  selected: boolean;
  answered: boolean;
  customText?: string;
  onSelect: (questionId: string, optionId: string) => void;
  onCustomTextChange?: (questionId: string, text: string) => void;
  onCommitCustomText?: (questionId: string) => void;
}

export default function QuestionOption({
  option,
  questionId,
  isMulti,
  selected,
  answered,
  customText = '',
  onSelect,
  onCustomTextChange,
  onCommitCustomText,
}: Props) {
  const isCustomRow = option.id === CUSTOM_ID;

  return (
    <TouchableOpacity
      accessibilityLabel={option.label}
      style={[s.opt, selected && s.optSelected, answered && s.optReadonly]}
      onPress={() => onSelect(questionId, option.id)}
      activeOpacity={answered ? 1 : 0.7}
    >
      {isMulti ? (
        <View style={[s.checkbox, selected && s.checkboxSelected]}>
          {selected && <View style={s.checkboxTick} />}
        </View>
      ) : (
        <View style={[s.radio, selected && s.radioSelected]} />
      )}
      {isCustomRow && selected ? (
        <View style={s.customEditor}>
          <TextInput
            style={s.customInput}
            placeholder="Type your answer..."
            placeholderTextColor="#555555"
            value={customText}
            onChangeText={(text) => onCustomTextChange?.(questionId, text)}
            maxLength={200}
            autoFocus
          />
          <TouchableOpacity
            accessibilityLabel="Use answer"
            accessibilityState={{
              disabled: customText.trim().length === 0,
            }}
            style={[s.useAnswerBtn, customText.trim().length === 0 && s.useAnswerBtnOff]}
            onPress={() => onCommitCustomText?.(questionId)}
          >
            <Text style={s.useAnswerText}>Use</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={s.optLabel}>{option.label}</Text>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
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
  optReadonly: { opacity: 0.6 },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#555555',
    backgroundColor: '#252525',
  },
  radioSelected: { borderColor: '#4CAF50', backgroundColor: '#4CAF50' },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: '#555555',
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { borderColor: '#4CAF50', backgroundColor: '#4CAF50' },
  checkboxTick: {
    width: 8,
    height: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },
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
});

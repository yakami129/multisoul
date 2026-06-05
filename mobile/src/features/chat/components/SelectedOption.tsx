import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';

interface Props {
  label: string;
  isMulti: boolean;
  answered: boolean;
  showEdit: boolean;
  onEdit: () => void;
}

export default function SelectedOption({ label, isMulti, answered, showEdit, onEdit }: Props) {
  return (
    <View style={[s.opt, s.optSelected]}>
      {isMulti ? (
        <View style={[s.checkbox, s.checkboxSelected]}>
          <View style={s.checkboxTick} />
        </View>
      ) : (
        <View style={[s.radio, s.radioSelected]} />
      )}
      <Text style={s.optLabel}>{label}</Text>
      {!answered && showEdit && (
        <TouchableOpacity accessibilityLabel="Edit" style={s.editBtn} onPress={onEdit}>
          <Text style={s.editText}>Edit</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white70,
    paddingHorizontal: 12,
    gap: 10,
  },
  optSelected: { borderColor: brandColors.lime, backgroundColor: brandRgba.limeSoft },
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
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: brandColors.textSoft,
    backgroundColor: brandRgba.white70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { borderColor: brandColors.lime, backgroundColor: brandColors.lime },
  checkboxTick: {
    width: 8,
    height: 8,
    backgroundColor: brandColors.ink,
    borderRadius: 1,
  },
  optLabel: { fontFamily: brandTypography.body, fontSize: 14, color: brandColors.ink },
  editBtn: {
    marginLeft: 'auto',
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: brandColors.textSoft,
    backgroundColor: brandRgba.white70,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editText: {
    fontFamily: brandTypography.body,
    fontSize: 11,
    fontWeight: '700',
    color: brandColors.textSoft,
  },
});

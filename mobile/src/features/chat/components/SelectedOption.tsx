import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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
});

import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { brandColors } from '@/theme/brandRefresh';
import { type AgentTarget } from './types';

interface Props {
  value?: AgentTarget;
  onPress: () => void;
  title?: string;
  placeholder?: string;
  changeLabel?: string;
  accessibilityLabel?: string;
}

export function AgentTargetField({
  value,
  onPress,
  title,
  placeholder,
  changeLabel,
  accessibilityLabel,
}: Props) {
  const { t } = useTranslation();
  const fieldTitle = title ?? t('specs.editorProjectAgent');
  const fieldPlaceholder = placeholder ?? t('specs.editorChoose');
  const fieldChangeLabel = changeLabel ?? t('specs.editorChange');

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? fieldTitle}
      onPress={onPress}
      style={s.targetRow}
    >
      <View style={s.targetBody}>
        <Text style={s.targetTitle}>{fieldTitle}</Text>
        <Text style={s.targetSubtitle} numberOfLines={1}>
          {value ? value.agentName : fieldPlaceholder}
        </Text>
      </View>
      <Text style={s.chooseText}>{value ? fieldChangeLabel : fieldPlaceholder}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  targetRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12 },
  targetBody: { flex: 1, minWidth: 0 },
  targetTitle: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.ink },
  targetSubtitle: { marginTop: 2, fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  chooseText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.coral },
});

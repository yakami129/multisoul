import { ChevronDown, ChevronLeft } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { s } from './styles';

interface Props {
  title: string;
  badge: { label: string; bg: string; dot: string };
  modelLabel?: string;
  modelDisabled?: boolean;
  onBack: () => void;
  onPressModel?: () => void;
}

export default function ChatHeader({
  title,
  badge,
  modelLabel,
  modelDisabled = false,
  onBack,
  onPressModel,
}: Props) {
  return (
    <View style={s.nav}>
      <TouchableOpacity onPress={onBack}>
        <ChevronLeft size={24} color="#FFFFFF" />
      </TouchableOpacity>
      <View style={hs.navCenter}>
        <Text style={s.navTitle} numberOfLines={1}>
          {title}
        </Text>
        {modelLabel && onPressModel ? (
          <TouchableOpacity
            style={[hs.modelButton, modelDisabled ? hs.modelButtonDisabled : null]}
            onPress={onPressModel}
          >
            <Text style={hs.modelButtonText} numberOfLines={1}>
              {modelLabel}
            </Text>
            <ChevronDown size={14} color="#888888" />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
        <View style={[s.statusDot, { backgroundColor: badge.dot }]} />
        <Text testID="status-badge-text" style={s.statusBadgeText}>
          {badge.label}
        </Text>
      </View>
    </View>
  );
}

const hs = StyleSheet.create({
  navCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  modelButton: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: 160 },
  modelButtonDisabled: { opacity: 0.5 },
  modelButtonText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#888888' },
});

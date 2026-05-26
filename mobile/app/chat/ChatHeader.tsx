import { ChevronLeft } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { s } from './styles';

interface Props {
  title: string;
  badge: { label: string; bg: string; dot: string };
  onBack: () => void;
}

export default function ChatHeader({ title, badge, onBack }: Props) {
  return (
    <View style={s.nav}>
      <TouchableOpacity onPress={onBack}>
        <ChevronLeft size={24} color="#FFFFFF" />
      </TouchableOpacity>
      <View style={s.navCenter}>
        <Text style={s.navTitle} numberOfLines={1}>
          {title}
        </Text>
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

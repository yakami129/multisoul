import { ChevronLeft, Laptop, MoreHorizontal } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { brandColors } from '@/theme/brandRefresh';
import { s } from './styles';

interface Props {
  title: string;
  badge: { label: string; bg: string; dot: string; fg: string };
  endpointName: string;
  connectionLabel: string;
  connectionDot: string;
  connectionTextColor: string;
  onBack: () => void;
  onMore: () => void;
}

export default function ChatHeader({
  title,
  badge,
  endpointName,
  connectionLabel,
  connectionDot,
  connectionTextColor,
  onBack,
  onMore,
}: Props) {
  return (
    <View testID="chat-header-nav" style={s.nav}>
      <TouchableOpacity
        testID="chat-header-back-button"
        accessibilityRole="button"
        accessibilityLabel="Back"
        activeOpacity={0.74}
        onPress={onBack}
        style={[s.navCircleButton, s.navBackButton]}
      >
        <ChevronLeft size={19} color={brandColors.ink} strokeWidth={1.6} />
      </TouchableOpacity>
      <View style={s.navCenter}>
        <Text style={s.navTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
          <View style={[s.statusDot, { backgroundColor: badge.dot }]} />
          <Text testID="status-badge-text" style={[s.statusBadgeText, { color: badge.fg }]}>
            {badge.label}
          </Text>
        </View>
        <View style={s.endpointRow}>
          <Laptop size={11} color={brandColors.ink} strokeWidth={1.3} />
          <Text testID="chat-header-endpoint-name" style={s.endpointName} numberOfLines={1}>
            {endpointName}
          </Text>
          <View style={[s.connectionDot, { backgroundColor: connectionDot }]} />
          <Text style={[s.connectionText, { color: connectionTextColor }]} numberOfLines={1}>
            {connectionLabel}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        testID="chat-header-more-button"
        accessibilityRole="button"
        accessibilityLabel="Chat options"
        activeOpacity={0.74}
        onPress={onMore}
        style={[s.navCircleButton, s.navMoreButton]}
      >
        <MoreHorizontal size={18} color={brandColors.ink} strokeWidth={1.8} />
      </TouchableOpacity>
    </View>
  );
}

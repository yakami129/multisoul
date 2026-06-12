import { ChevronRight } from 'lucide-react-native';
import React from 'react';
import { Image, type ImageSourcePropType, Text, TouchableOpacity, View } from 'react-native';
import { brandColors } from '@/theme/brandRefresh';
import { s } from './AgentList.styles';

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function StatCell({
  value,
  label,
  color,
  icon,
  bordered,
}: {
  value: number;
  label: string;
  color: string;
  icon: React.ReactNode;
  bordered?: boolean;
}) {
  return (
    <View style={[s.statCell, bordered && s.statCellBorder]}>
      <View style={[s.statIcon, { backgroundColor: color }]}>{icon}</View>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function QuickWorkflowCard({
  title,
  subtitle,
  image,
  onPress,
}: {
  title: string;
  subtitle: string;
  image: ImageSourcePropType;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={s.workflowCard}
    >
      <Image source={image} style={s.workflowImage} resizeMode="contain" />
      <View style={s.workflowCopy}>
        <Text style={s.workflowTitle} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        <Text style={s.workflowSubtitle} numberOfLines={1} ellipsizeMode="tail">
          {subtitle}
        </Text>
      </View>
      <View style={s.workflowArrow}>
        <ChevronRight size={18} color={brandColors.ink} />
      </View>
    </TouchableOpacity>
  );
}

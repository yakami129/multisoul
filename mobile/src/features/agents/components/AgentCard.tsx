import { Code2, Folder, MoreHorizontal, MousePointer2, Terminal } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useReduceMotionPreference } from '@/hooks/useReduceMotionPreference';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Agent } from '@/types';
import { RunningAgentBreath } from './RunningAgentBreath';

interface Props {
  agent: Agent;
  onPress: () => void;
  index?: number;
  statusLabel?: string;
  isActive?: boolean;
  pendingCount?: number;
  metaVariant?: 'status' | 'machine';
  showBreathingEffect?: boolean;
}

type RuntimeSpec = {
  backgroundColor: string;
  icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
};

const fallbackAvatarColors = [
  brandColors.coral,
  brandColors.cyan,
  brandColors.lime,
  brandColors.sage,
];

const runtimeSpecs: Partial<Record<Agent['runtime'], RuntimeSpec>> = {
  'claude-code': {
    backgroundColor: brandColors.lime,
    icon: Code2,
  },
  codex: {
    backgroundColor: brandColors.cyan,
    icon: Terminal,
  },
  'cursor-cli': {
    backgroundColor: brandColors.sage,
    icon: MousePointer2,
  },
};

function AgentCardBreath({ accentColor }: { accentColor: string }) {
  const reduceMotionEnabled = useReduceMotionPreference();

  return (
    <RunningAgentBreath enabled reducedMotion={reduceMotionEnabled} accentColor={accentColor} />
  );
}

function relativeAge(ts: number) {
  if (ts <= 0) {
    return 'now';
  }
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return `${Math.floor(hours / 24)}d ago`;
}

function formatProjectPath(path: string) {
  if (!path) return 'No project path';
  const normalized = path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('~') && parts.length > 3) {
    return `~/${parts.slice(-2).join('/')}`;
  }
  if (parts.length > 3) return `.../${parts.slice(-2).join('/')}`;
  return normalized;
}

function statusTone(statusLabel: string, isActive: boolean, pendingCount: number) {
  const lower = statusLabel.toLowerCase();
  if (pendingCount > 0 || lower.includes('awaiting')) {
    return {
      label: 'Needs Decision',
      dot: brandColors.coral,
      bg: brandRgba.coralSoft,
      text: brandColors.coral,
    };
  }
  if (lower.includes('running') || isActive) {
    return {
      label: 'Running',
      dot: brandColors.cyan,
      bg: brandRgba.cyanSoft,
      text: brandColors.cyan,
    };
  }
  if (lower.includes('failed')) {
    return {
      label: 'Failed',
      dot: brandColors.error,
      bg: brandRgba.coralSoft,
      text: brandColors.error,
    };
  }
  return {
    label: 'Idle',
    dot: brandColors.textMuted,
    bg: brandRgba.ink08,
    text: brandColors.textSoft,
  };
}

export function AgentCard({
  agent,
  onPress,
  index = 0,
  statusLabel = 'Idle',
  isActive = false,
  pendingCount = 0,
  metaVariant = 'machine',
  showBreathingEffect = false,
}: Props) {
  const runtimeSpec = runtimeSpecs[agent.runtime];
  const avatarColor =
    runtimeSpec?.backgroundColor ?? fallbackAvatarColors[index % fallbackAvatarColors.length];
  const RuntimeIcon = runtimeSpec?.icon ?? Terminal;
  const accentColor = avatarColor;
  const tone = statusTone(statusLabel, isActive, pendingCount);
  const metaLabel =
    metaVariant === 'status'
      ? statusLabel
      : `${agent.endpoint_label} · ${relativeAge(agent.created_at)}`;

  return (
    <Pressable
      onPress={onPress}
      testID="project-row"
      style={s.row}
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}`}
    >
      {showBreathingEffect ? <AgentCardBreath accentColor={accentColor} /> : null}
      <View style={s.avatarFrame}>
        <View testID="project-avatar" style={[s.avatar, { backgroundColor: avatarColor }]}>
          <RuntimeIcon size={20} color={brandColors.white} strokeWidth={2.4} />
        </View>
      </View>
      <View testID="project-body" style={s.body}>
        <View style={s.titleRow}>
          <Text style={s.agentName} numberOfLines={1}>
            {agent.name}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaText} numberOfLines={1}>
            {metaLabel}
          </Text>
        </View>
        <View style={s.pathRow}>
          <Folder size={14} color={brandColors.textMuted} />
          <Text style={s.pathText} numberOfLines={1}>
            {formatProjectPath(agent.project_path)}
          </Text>
        </View>
      </View>
      <View style={s.trailing}>
        <View style={[s.statusPill, { backgroundColor: tone.bg }]}>
          <View style={[s.statusDot, { backgroundColor: tone.dot }]} />
          <Text style={[s.statusText, { color: tone.text }]} numberOfLines={1}>
            {pendingCount > 1 ? `${tone.label} ${pendingCount}` : tone.label}
          </Text>
        </View>
        <View testID="project-chevron" style={s.moreButton}>
          <MoreHorizontal size={16} color={brandColors.ink} />
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    width: '100%',
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 7,
    position: 'relative',
    borderRadius: 18,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    shadowColor: brandColors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  avatarFrame: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: brandRgba.white70,
    borderWidth: 1,
    borderColor: brandColors.silver,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  agentName: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: brandColors.ink,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaText: { flex: 1, fontFamily: 'Inter', fontSize: 11, color: brandColors.textSoft },
  pathRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pathText: { flex: 1, fontFamily: 'Inter', fontSize: 10, color: brandColors.textMuted },
  trailing: {
    marginLeft: 7,
    alignItems: 'flex-end',
    gap: 5,
  },
  statusPill: {
    minHeight: 22,
    maxWidth: 112,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingHorizontal: 7,
    gap: 4,
  },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { flexShrink: 1, fontFamily: 'Inter', fontSize: 10, fontWeight: '700' },
  moreButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: brandRgba.ink08,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

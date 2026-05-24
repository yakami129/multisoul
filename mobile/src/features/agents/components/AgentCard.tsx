import { ChevronRight } from 'lucide-react-native';
import React from 'react';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Agent } from '@/types';
import claudeCodeIcon from '../../../../assets/agent-icons/runtime-claude-code.png';
import codexIcon from '../../../../assets/agent-icons/runtime-codex.png';
import cursorCliIcon from '../../../../assets/agent-icons/runtime-cursor-cli.png';

interface Props {
  agent: Agent;
  onPress: () => void;
  index?: number;
  statusLabel?: string;
  isActive?: boolean;
  pendingCount?: number;
  metaVariant?: 'status' | 'machine';
}

type RuntimeMascotSpec = {
  backgroundColor: string;
  label: string;
  source: ImageSourcePropType;
};

const ORANGE = '#FF6B35';
const BLUE = '#2563EB';
const SURFACE = '#252525';

const fallbackAvatarColors = [ORANGE, '#7C3AED', BLUE, '#059669'];

const runtimeMascots: Partial<Record<Agent['runtime'], RuntimeMascotSpec>> = {
  'claude-code': {
    backgroundColor: SURFACE,
    label: 'Claude Code pixel mascot icon',
    source: claudeCodeIcon,
  },
  codex: {
    backgroundColor: ORANGE,
    label: 'Codex pixel mascot icon',
    source: codexIcon,
  },
  'cursor-cli': {
    backgroundColor: BLUE,
    label: 'Cursor pixel mascot icon',
    source: cursorCliIcon,
  },
};

function RuntimeMascotIcon({
  runtime,
  spec,
}: {
  runtime: Agent['runtime'];
  spec: RuntimeMascotSpec;
}) {
  return (
    <Image
      testID={`runtime-pixel-${runtime}`}
      accessibilityIgnoresInvertColors
      accessibilityLabel={spec.label}
      resizeMode="cover"
      source={spec.source}
      style={s.pixelImage}
    />
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

export function AgentCard({
  agent,
  onPress,
  index = 0,
  statusLabel = 'Idle',
  isActive = false,
  pendingCount = 0,
  metaVariant = 'machine',
}: Props) {
  const mascot = runtimeMascots[agent.runtime];
  const avatarColor =
    mascot?.backgroundColor ?? fallbackAvatarColors[index % fallbackAvatarColors.length];
  const metaLabel =
    metaVariant === 'status'
      ? statusLabel
      : `${agent.endpoint_label} · ${relativeAge(agent.created_at)}`;
  const highlightMeta = metaVariant === 'status' && isActive;

  return (
    <Pressable
      onPress={onPress}
      testID="project-row"
      style={s.row}
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}`}
    >
      <View testID="project-avatar" style={[s.avatar, { backgroundColor: avatarColor }]}>
        {mascot ? <RuntimeMascotIcon runtime={agent.runtime} spec={mascot} /> : null}
      </View>
      <View testID="project-body" style={s.body}>
        <View style={s.titleRow}>
          <Text style={s.agentName} numberOfLines={1}>
            {agent.name}
          </Text>
          {pendingCount > 0 ? (
            <View style={s.countBadge}>
              <Text style={s.countText}>{pendingCount}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.metaRow}>
          <View style={[s.statusDot, isActive && s.statusDotActive]} />
          <Text style={[s.metaText, highlightMeta && s.metaTextActive]} numberOfLines={1}>
            {metaLabel}
          </Text>
        </View>
      </View>
      <View testID="project-chevron" style={s.chevron}>
        <ChevronRight size={14} color="#666666" />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    width: '100%',
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  pixelImage: {
    width: 40,
    height: 40,
    borderRadius: 9,
  },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  agentName: { flex: 1, fontFamily: 'Inter', fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#555555', marginRight: 5 },
  statusDotActive: { backgroundColor: '#4CAF50' },
  metaText: { flex: 1, fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  metaTextActive: { color: '#4CAF50' },
  countBadge: {
    minWidth: 24,
    borderRadius: 12,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  countText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  chevron: {
    width: 14,
    height: 14,
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

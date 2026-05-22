import { ChevronRight, Cpu } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Agent } from '@/types';

interface Props {
  agent: Agent;
  onPress: () => void;
  index?: number;
  statusLabel?: string;
  isActive?: boolean;
  pendingCount?: number;
}

const avatarColors = ['#FF6B35', '#7C3AED', '#2563EB', '#059669'];

function displayRuntime(runtime: Agent['runtime']) {
  switch (runtime) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor-cli':
      return 'Cursor CLI';
    case 'custom':
      return 'Custom';
  }
}

export function AgentCard({
  agent,
  onPress,
  index = 0,
  statusLabel = 'Idle',
  isActive = false,
  pendingCount = 0,
}: Props) {
  const avatarColor = avatarColors[index % avatarColors.length];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}`}
    >
      <View style={[s.avatar, { backgroundColor: avatarColor }]}>
        <Cpu size={18} color="#FFFFFF" />
      </View>
      <View style={s.body}>
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
          <Text style={[s.metaText, isActive && s.metaTextActive]} numberOfLines={1}>
            {statusLabel} · {displayRuntime(agent.runtime)}
          </Text>
        </View>
      </View>
      <ChevronRight size={14} color="#666666" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    width: '100%',
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  rowPressed: { opacity: 0.72 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  agentName: { flex: 1, fontFamily: 'Inter', fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#555555' },
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
});

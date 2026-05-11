import { Zap } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Agent } from '@/types';

interface Props {
  agent: Agent;
  onPress: () => void;
  index?: number;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function AgentCard({ agent, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.wrap, pressed && s.wrapPressed]}>
      <View style={s.card}>
        {/* Card header row */}
        <View style={s.cardHeader}>
          <View style={s.cardHeaderLeft}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials(agent.name)}</Text>
            </View>
            <View style={s.nameLine}>
              <Text style={s.agentName} numberOfLines={1}>
                {agent.name.toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={s.runtimeBadge}>
            <Text style={s.runtimeText}>{agent.runtime.toUpperCase()}</Text>
          </View>
        </View>

        {/* Project path */}
        <View style={s.endpointRow}>
          <Zap size={12} color="#555555" />
          <Text style={s.endpointText} numberOfLines={1}>
            {agent.project_path}
          </Text>
        </View>

        {/* Endpoint label badge */}
        <View style={s.machineRow}>
          <Text style={s.machineText}>{agent.endpoint_label.toUpperCase()}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 6 },
  wrapPressed: { opacity: 0.7 },
  card: { backgroundColor: '#1A1A1A', borderRadius: 12, overflow: 'hidden' },
  cardHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Anton', fontSize: 14, color: '#FFFFFF' },
  nameLine: { flex: 1 },
  agentName: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  runtimeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#0D0D0D',
  },
  runtimeText: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#888888',
    letterSpacing: 0.5,
  },
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  endpointText: { fontFamily: 'Inter', fontSize: 12, color: '#888888', flex: 1 },
  machineRow: { paddingHorizontal: 16, paddingBottom: 10 },
  machineText: { fontFamily: 'Inter', fontSize: 11, color: '#555555', letterSpacing: 1 },
});

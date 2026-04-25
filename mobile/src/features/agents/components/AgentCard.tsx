import { Zap } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Agent, AgentStatus } from '@/types';

interface Props {
  agent: Agent;
  onPress: () => void;
  index?: number;
}

const STATUS_COLOR: Record<AgentStatus, string> = {
  active: '#33FF33',
  inactive: '#2D8B2D',
  error: '#FFB000',
};

const STATUS_BG: Record<AgentStatus, string> = {
  active: '#0A1A0A',
  inactive: '#0A1A0A',
  error: '#1A1000',
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function AgentCard({ agent, onPress }: Props) {
  const statusColor = STATUS_COLOR[agent.status];
  const statusBg = STATUS_BG[agent.status];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.wrap, pressed && s.wrapPressed]}
    >
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
          <View style={[s.statusBadge, { backgroundColor: statusBg }]}>
            <View style={[s.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[s.statusText, { color: statusColor }]}>
              {agent.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Endpoint */}
        <View style={s.endpointRow}>
          <Zap size={12} color="#0F6B0F" />
          <Text style={s.endpointText} numberOfLines={1}>
            {agent.endpoint}
          </Text>
        </View>

        {/* Description */}
        {agent.description ? (
          <Text style={s.description} numberOfLines={2}>
            {agent.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  wrapPressed: {
    opacity: 0.7,
  },
  card: {
    backgroundColor: '#061206',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    overflow: 'hidden',
  },
  cardHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 2,
    backgroundColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Anton',
    fontSize: 11,
    color: '#20C20E',
  },
  nameLine: {
    flex: 1,
  },
  agentName: {
    fontFamily: 'Anton',
    fontSize: 14,
    color: '#20C20E',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  endpointText: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    color: '#0F6B0F',
    flex: 1,
  },
  description: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#147A16',
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
});

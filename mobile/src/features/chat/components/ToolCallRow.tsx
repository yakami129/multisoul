import { ChevronDown, ChevronRight } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { type ToolCallPayload, type ToolResultPayload } from '@/types';

interface Props {
  call: ToolCallPayload;
  result?: ToolResultPayload;
}

export function ToolCallRow({ call, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = result ? (result.ok ? '#33FF33' : '#FFB000') : '#2D8B2D';
  const summary = result ? `-> ${result.ok ? 'ok' : 'err'}: ${result.summary}` : '-> pending';

  return (
    <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={s.row}>
      {expanded ? (
        <ChevronDown size={12} color="#2D8B2D" />
      ) : (
        <ChevronRight size={12} color="#2D8B2D" />
      )}
      <Text style={s.tool}>[{call.tool}]</Text>
      <Text style={s.args} numberOfLines={expanded ? undefined : 1}>
        {call.args}
      </Text>
      {!expanded && <Text style={[s.status, { color: statusColor }]}>{summary}</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: '#0A1A0A',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  tool: { fontFamily: 'Geist Mono', fontSize: 11, color: '#2D8B2D' },
  args: { fontFamily: 'Geist Mono', fontSize: 11, color: '#147A16', flex: 1 },
  status: { fontFamily: 'Geist Mono', fontSize: 11 },
});

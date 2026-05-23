import { ChevronDown, ChevronRight } from 'lucide-react-native';
import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { type ToolCallPayload, type ToolResultPayload } from '@/types';

interface Props {
  call: ToolCallPayload;
  result?: ToolResultPayload;
}

export function ToolCallRow({ call, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = result ? (result.ok ? '#4CAF50' : '#FF4444') : '#555555';
  const summary = result ? `-> ${result.ok ? 'ok' : 'err'}: ${result.summary}` : '-> pending';

  return (
    <TouchableOpacity testID="tool-call-row" onPress={() => setExpanded((v) => !v)} style={s.row}>
      {expanded ? (
        <ChevronDown size={12} color="#555555" />
      ) : (
        <ChevronRight size={12} color="#555555" />
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
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  tool: { fontFamily: 'Inter', fontSize: 11, color: '#888888' },
  args: { fontFamily: 'Inter', fontSize: 11, color: '#666666', flex: 1 },
  status: { fontFamily: 'Inter', fontSize: 11 },
});

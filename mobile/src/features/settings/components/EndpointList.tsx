import { Trash2 } from 'lucide-react-native';
import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { type Endpoint } from '@/types';

interface Props {
  endpoints: Endpoint[];
  onRemove: (id: string) => void;
}

export function EndpointList({ endpoints, onRemove }: Props) {
  if (endpoints.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>NO ENDPOINTS CONFIGURED</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={endpoints}
      keyExtractor={(e) => e.id}
      contentContainerStyle={s.list}
      scrollEnabled={false}
      renderItem={({ item }) => {
        const online = item.last_seen_at !== null && Date.now() - item.last_seen_at < 60_000;
        return (
          <View style={s.row}>
            <View style={[s.dot, { backgroundColor: online ? '#4CAF50' : '#555555' }]} />
            <View style={s.info}>
              <Text style={s.label}>{item.label}</Text>
              <Text style={s.url} numberOfLines={1}>
                {item.base_url}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onRemove(item.id)} hitSlop={8}>
              <Trash2 size={16} color="#888888" />
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  empty: { paddingVertical: 24, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter', fontSize: 13, color: '#888888', letterSpacing: 1 },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  info: { flex: 1, gap: 3 },
  label: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  url: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
});

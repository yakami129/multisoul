import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { Endpoint } from '@/types';

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
            <View style={[s.dot, { backgroundColor: online ? '#33FF33' : '#2D8B2D' }]} />
            <View style={s.info}>
              <Text style={s.label}>{item.label}</Text>
              <Text style={s.url} numberOfLines={1}>{item.base_url}</Text>
            </View>
            <TouchableOpacity onPress={() => onRemove(item.id)} hitSlop={8}>
              <Trash2 size={16} color="#2D8B2D" />
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  empty:     { paddingVertical: 24, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 2 },
  list:      { gap: 8 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12,
               backgroundColor: '#061206', borderWidth: 1, borderColor: '#0F2B0F',
               borderRadius: 2, padding: 12 },
  dot:       { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  info:      { flex: 1, gap: 2 },
  label:     { fontFamily: 'Anton', fontSize: 13, color: '#20C20E', letterSpacing: 1 },
  url:       { fontFamily: 'Geist', fontSize: 12, color: '#2D8B2D' },
});

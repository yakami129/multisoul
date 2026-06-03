import { ChevronRight, Laptop, Plus, Server, Trash2 } from 'lucide-react-native';
import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Endpoint } from '@/types';

interface Props {
  endpoints: Endpoint[];
  onRemove: (id: string) => void;
  onAddEndpoint?: () => void;
}

function endpointOnline(endpoint: Endpoint) {
  return endpoint.last_seen_at !== null && Date.now() - endpoint.last_seen_at < 60_000;
}

export function EndpointList({ endpoints, onRemove, onAddEndpoint }: Props) {
  const data = [...endpoints, null];

  if (endpoints.length === 0) {
    return (
      <View style={s.card}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Add endpoint"
          onPress={onAddEndpoint}
          style={s.row}
        >
          <View style={s.addIcon}>
            <Plus size={24} color={brandColors.ink} />
          </View>
          <View style={s.info}>
            <Text style={s.label}>Add Endpoint</Text>
            <Text style={s.url}>Scan a setup QR to connect your first machine</Text>
          </View>
          <ChevronRight size={24} color={brandColors.textSoft} />
        </TouchableOpacity>
        <Text style={s.emptyText}>NO ENDPOINTS CONFIGURED</Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <FlatList
        data={data}
        keyExtractor={(item, index) => item?.id ?? `add-${index}`}
        scrollEnabled={false}
        renderItem={({ item, index }) => {
          const isLast = index === data.length - 1;
          if (!item) {
            return (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Add endpoint"
                onPress={onAddEndpoint}
                style={[s.row, isLast && s.rowLast]}
              >
                <View style={s.addIcon}>
                  <Plus size={24} color={brandColors.ink} />
                </View>
                <View style={s.info}>
                  <Text style={s.label}>Add Endpoint</Text>
                </View>
                <ChevronRight size={24} color={brandColors.textSoft} />
              </TouchableOpacity>
            );
          }

          const online = endpointOnline(item);
          const EndpointIcon = online ? Laptop : Server;
          return (
            <View style={[s.row, !isLast && s.divided]}>
              <View
                style={[
                  s.endpointIcon,
                  { backgroundColor: online ? brandColors.lime : brandColors.cyan },
                ]}
              >
                <EndpointIcon size={28} color={brandColors.ink} strokeWidth={2.2} />
              </View>
              <View style={s.info}>
                <Text style={s.label} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={s.url} numberOfLines={1}>
                  {item.base_url}
                </Text>
              </View>
              <View style={s.statusWrap}>
                <View
                  style={[
                    s.statusDot,
                    { backgroundColor: online ? brandColors.lime : brandColors.cyan },
                  ]}
                />
                <View style={[s.statusPill, online ? s.statusLive : s.statusIdle]}>
                  <Text style={[s.statusText, online ? s.statusLiveText : s.statusIdleText]}>
                    {online ? 'Live' : 'Idle'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.label}`}
                hitSlop={8}
                onPress={() => onRemove(item.id)}
                style={s.deleteButton}
              >
                <Trash2 size={18} color={brandColors.coral} />
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 22,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    overflow: 'hidden',
  },
  row: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowLast: { borderBottomWidth: 0 },
  divided: { borderBottomWidth: 1, borderBottomColor: brandRgba.silver78 },
  endpointIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  addIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: brandRgba.ink08,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  info: { flex: 1, minWidth: 0 },
  label: { fontFamily: 'Inter', fontSize: 15, fontWeight: '700', color: brandColors.ink },
  url: { marginTop: 4, fontFamily: 'Inter', fontSize: 13, color: brandColors.textMuted },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPill: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statusLive: { backgroundColor: brandRgba.limeSoft, borderColor: brandColors.lime },
  statusIdle: { backgroundColor: brandRgba.cyanSoft, borderColor: brandColors.cyan },
  statusText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '700' },
  statusLiveText: { color: brandColors.textSoft },
  statusIdleText: { color: brandColors.textSoft },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  emptyText: {
    paddingBottom: 18,
    textAlign: 'center',
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textMuted,
    letterSpacing: 1,
  },
});

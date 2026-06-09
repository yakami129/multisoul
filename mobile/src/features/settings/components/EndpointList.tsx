import { ChevronRight, Laptop, Plus, Server, Trash2 } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { endpointOnline } from '@/features/settings/services/endpointLiveness';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Endpoint } from '@/types';

interface Props {
  endpoints: Endpoint[];
  onRemove: (id: string) => void;
  onAddEndpoint?: () => void;
}

export function EndpointList({ endpoints, onRemove, onAddEndpoint }: Props) {
  const { t } = useTranslation();
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
            <Plus size={20} color={brandColors.ink} />
          </View>
          <View style={s.info}>
            <Text style={s.label} numberOfLines={1}>
              Add Endpoint
            </Text>
            <Text style={s.url} numberOfLines={1}>
              Scan a setup QR to connect your first machine
            </Text>
          </View>
          <ChevronRight size={18} color={brandColors.textSoft} />
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
                  <Plus size={20} color={brandColors.ink} />
                </View>
                <View style={s.info}>
                  <Text style={s.label} numberOfLines={1}>
                    Add Endpoint
                  </Text>
                </View>
                <ChevronRight size={18} color={brandColors.textSoft} />
              </TouchableOpacity>
            );
          }

          const online = endpointOnline(item.last_seen_at);
          const EndpointIcon = online ? Laptop : Server;
          return (
            <View style={[s.row, !isLast && s.divided]}>
              <View
                style={[
                  s.endpointIcon,
                  { backgroundColor: online ? brandColors.lime : brandColors.cyan },
                ]}
              >
                <EndpointIcon size={20} color={brandColors.ink} strokeWidth={2.2} />
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
                  <Text
                    style={[s.statusText, online ? s.statusLiveText : s.statusIdleText]}
                    numberOfLines={1}
                  >
                    {online ? t('settings.online') : t('settings.offline')}
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
                <Trash2 size={16} color={brandColors.coral} />
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
    borderRadius: 18,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    overflow: 'hidden',
  },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  rowLast: { borderBottomWidth: 0 },
  divided: { borderBottomWidth: 1, borderBottomColor: brandRgba.silver78 },
  endpointIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  addIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: brandRgba.ink08,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  info: { flex: 1, minWidth: 0 },
  label: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: brandColors.ink,
  },
  url: { marginTop: 2, fontFamily: 'Inter', fontSize: 11, color: brandColors.textMuted },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPill: {
    minHeight: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statusLive: { backgroundColor: brandRgba.limeSoft, borderColor: brandColors.lime },
  statusIdle: { backgroundColor: brandRgba.cyanSoft, borderColor: brandColors.cyan },
  statusText: { fontFamily: 'Inter', fontSize: 10, fontWeight: '700' },
  statusLiveText: { color: brandColors.textSoft },
  statusIdleText: { color: brandColors.textSoft },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  emptyText: {
    paddingBottom: 14,
    textAlign: 'center',
    fontFamily: 'Inter',
    fontSize: 10,
    color: brandColors.textMuted,
    letterSpacing: 1,
  },
});

import { CircleCheck, Clock3, MessageCircle, Sparkles } from 'lucide-react-native';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface ActivityItem {
  id: string;
  section: 'attention' | 'running' | 'done';
  projectName: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: 'attention' | 'running' | 'done' | 'failed';
  timestamp: number;
}

interface Props {
  needsAttention: ActivityItem[];
  running: ActivityItem[];
  done: ActivityItem[];
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onOpenItem: (item: ActivityItem) => void;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Section({
  title,
  items,
  emptyText,
  onOpenItem,
}: {
  title: string;
  items: ActivityItem[];
  emptyText: string;
  onOpenItem: (item: ActivityItem) => void;
}) {
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>{title}</Text>
        <Text style={s.sectionCount}>{items.length}</Text>
      </View>
      {items.length === 0 ? (
        <Text style={s.emptySectionText}>{emptyText}</Text>
      ) : (
        items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={s.row}
            onPress={() => onOpenItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
          >
            <View
              style={[
                s.iconWrap,
                item.tone === 'attention' && s.iconAttention,
                item.tone === 'failed' && s.iconFailed,
              ]}
            >
              {item.section === 'attention' ? (
                <Sparkles size={15} color="#FF6B35" />
              ) : (
                <MessageCircle size={15} color={item.tone === 'failed' ? '#FF4444' : '#888888'} />
              )}
            </View>
            <View style={s.rowBody}>
              <View style={s.rowTop}>
                <Text style={s.projectName} numberOfLines={1}>
                  {item.projectName}
                </Text>
                <Text style={s.timeText}>{formatRelativeTime(item.timestamp)}</Text>
              </View>
              <Text style={s.itemTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={s.metaRow}>
                <Text style={s.subtitle} numberOfLines={1}>
                  {item.subtitle}
                </Text>
                <Text
                  style={[
                    s.statusLabel,
                    item.tone === 'attention' && s.statusAttention,
                    item.tone === 'running' && s.statusRunning,
                    item.tone === 'failed' && s.statusFailed,
                  ]}
                >
                  {item.statusLabel}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

export default function ActivityScreen({
  needsAttention,
  running,
  done,
  isRefreshing = false,
  onRefresh,
  onOpenItem,
}: Props) {
  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>Activity</Text>
        <View style={s.summaryRow}>
          <View style={s.summaryPill}>
            <Sparkles size={13} color="#FF6B35" />
            <Text style={s.summaryText}>{needsAttention.length} attention</Text>
          </View>
          <View style={s.summaryPill}>
            <Clock3 size={13} color="#888888" />
            <Text style={s.summaryText}>{running.length} running</Text>
          </View>
        </View>
      </View>

      {needsAttention.length === 0 && running.length === 0 && done.length === 0 ? (
        <ScrollView
          contentContainerStyle={s.emptyBody}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
        >
          <View style={s.emptyIconWrap}>
            <CircleCheck size={36} color="#4CAF50" />
          </View>
          <Text style={s.emptyTitle}>All caught up</Text>
          <Text style={s.emptyDesc}>No decisions, running sessions, or recent results.</Text>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
        >
          <Section
            title="Needs Attention"
            items={needsAttention}
            emptyText="No decisions waiting."
            onOpenItem={onOpenItem}
          />
          <Section
            title="Running"
            items={running}
            emptyText="No active sessions."
            onOpenItem={onOpenItem}
          />
          <Section
            title="Done"
            items={done}
            emptyText="No recent results."
            onOpenItem={onOpenItem}
          />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 12 },
  title: { fontFamily: 'Inter', fontSize: 34, fontWeight: '700', color: '#FFFFFF' },
  summaryRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  summaryText: { fontFamily: 'Inter', fontSize: 13, color: '#DDDDDD' },
  content: { paddingHorizontal: 16, paddingBottom: 110, gap: 18 },
  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#888888' },
  sectionCount: { fontFamily: 'Inter', fontSize: 12, color: '#666666' },
  emptySectionText: { fontFamily: 'Inter', fontSize: 13, color: '#666666', paddingVertical: 8 },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAttention: { backgroundColor: '#1A1A1A' },
  iconFailed: { backgroundColor: '#1A1A1A' },
  rowBody: { flex: 1, gap: 6 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  projectName: { flex: 1, fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  timeText: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },
  itemTitle: { fontFamily: 'Inter', fontSize: 15, color: '#DDDDDD', lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  subtitle: { flex: 1, fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  statusLabel: { fontFamily: 'Inter', fontSize: 11, fontWeight: '700', color: '#888888' },
  statusAttention: { color: '#FF6B35' },
  statusRunning: { color: '#FF6B35' },
  statusFailed: { color: '#FF4444' },
  emptyBody: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 80,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: { fontFamily: 'Inter', fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  emptyDesc: {
    marginTop: 8,
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 20,
  },
});

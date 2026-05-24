import {
  CircleCheck,
  Clock3,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

export interface ActivityItem {
  id: string;
  section: 'attention' | 'running' | 'done';
  projectName: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: 'attention' | 'running' | 'done' | 'failed';
  timestamp: number;
  endpointId: string;
  endpointLabel: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  askId?: string;
}

interface Props {
  needsAttention: ActivityItem[];
  running: ActivityItem[];
  done: ActivityItem[];
  failedEndpointLabels?: string[];
  hasEndpoints?: boolean;
  allFailed?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onRetry?: () => void;
  onOpenItem: (item: ActivityItem) => void;
  onDeleteItem?: (item: ActivityItem) => void;
}

type ActivityFilter = 'all' | 'pending' | 'running' | 'done';

const FILTERS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
];

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
  onDeleteItem,
  openSwipeableRef,
  swipeableRefs,
}: {
  title: string;
  items: ActivityItem[];
  emptyText: string;
  onOpenItem: (item: ActivityItem) => void;
  onDeleteItem?: (item: ActivityItem) => void;
  openSwipeableRef: React.MutableRefObject<Swipeable | null>;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable>>;
}) {
  const renderDeleteAction = (item: ActivityItem) => (
    <TouchableOpacity
      style={s.deleteAction}
      onPress={() => onDeleteItem?.(item)}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${item.title}`}
    >
      <Text style={s.deleteText}>DELETE</Text>
    </TouchableOpacity>
  );

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
          <Swipeable
            key={item.id}
            ref={(ref) => {
              if (ref) swipeableRefs.current.set(item.id, ref);
              else swipeableRefs.current.delete(item.id);
            }}
            onSwipeableOpen={() => {
              if (openSwipeableRef.current) openSwipeableRef.current.close();
              openSwipeableRef.current = swipeableRefs.current.get(item.id) ?? null;
            }}
            renderRightActions={() => renderDeleteAction(item)}
            overshootRight={false}
          >
            <TouchableOpacity
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
          </Swipeable>
        ))
      )}
    </View>
  );
}

function PartialFailureBanner({
  failedEndpointLabels,
  onRetry,
}: {
  failedEndpointLabels: string[];
  onRetry?: () => void;
}) {
  if (failedEndpointLabels.length === 0) return null;

  return (
    <View style={s.partialFailure}>
      <Text style={s.partialFailureText}>
        Some endpoints failed: {failedEndpointLabels.join(', ')}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry failed endpoints"
      >
        <Text style={s.partialFailureRetry}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ActivityScreen({
  needsAttention,
  running,
  done,
  failedEndpointLabels = [],
  hasEndpoints = true,
  allFailed = false,
  isRefreshing = false,
  onRefresh,
  onRetry,
  onOpenItem,
  onDeleteItem,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>('all');
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const showAttention = activeFilter === 'all' || activeFilter === 'pending';
  const showRunning = activeFilter === 'all' || activeFilter === 'running';
  const showDone = activeFilter === 'all' || activeFilter === 'done';
  const totalCount = needsAttention.length + running.length + done.length;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={s.title}>Activity</Text>
          <SlidersHorizontal size={22} color="#888888" />
        </View>
        <View style={s.summaryRow}>
          <View style={s.summaryPill}>
            <Sparkles size={13} color="#FF6B35" />
            <Text style={s.summaryText}>{needsAttention.length} pending</Text>
          </View>
          <View style={s.summaryPill}>
            <Clock3 size={13} color="#888888" />
            <Text style={s.summaryText}>{running.length} running</Text>
          </View>
        </View>
        <View style={s.filterWrap}>
          <Text style={s.filterLabel}>STATUS</Text>
          <View style={s.chipRow}>
            {FILTERS.map((filter) => {
              const selected = activeFilter === filter.key;
              return (
                <TouchableOpacity
                  key={filter.key}
                  style={[s.filterChip, selected && s.filterChipActive]}
                  onPress={() => setActiveFilter(filter.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Show ${filter.label} activity`}
                >
                  <Text style={[s.filterChipText, selected && s.filterChipTextActive]}>
                    {filter.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {allFailed ? (
        <ScrollView
          contentContainerStyle={s.emptyBody}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
          testID="activity-scroll"
        >
          <View style={s.emptyIconWrap}>
            <MessageCircle size={36} color="#FF4444" />
          </View>
          <Text style={s.emptyTitle}>Could not load activity</Text>
          <Text style={s.emptyDesc}>All configured endpoints failed to respond.</Text>
          <TouchableOpacity
            style={s.retryButton}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry activity"
          >
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : totalCount === 0 ? (
        <ScrollView
          contentContainerStyle={s.emptyBody}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
          testID="activity-scroll"
        >
          <PartialFailureBanner failedEndpointLabels={failedEndpointLabels} onRetry={onRetry} />
          <View style={s.emptyIconWrap}>
            <CircleCheck size={36} color="#4CAF50" />
          </View>
          <Text style={s.emptyTitle}>{hasEndpoints ? 'All caught up' : 'Connect an endpoint'}</Text>
          <Text style={s.emptyDesc}>
            {hasEndpoints
              ? 'No decisions, running sessions, or recent results.'
              : 'Add an endpoint in Settings to see Activity.'}
          </Text>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
          testID="activity-scroll"
        >
          <PartialFailureBanner failedEndpointLabels={failedEndpointLabels} onRetry={onRetry} />
          {showAttention && (
            <Section
              title="Needs Attention"
              items={needsAttention}
              emptyText="No pending decisions."
              onOpenItem={onOpenItem}
              onDeleteItem={onDeleteItem}
              openSwipeableRef={openSwipeableRef}
              swipeableRefs={swipeableRefs}
            />
          )}
          {showRunning && (
            <Section
              title="Running"
              items={running}
              emptyText="No active sessions."
              onOpenItem={onOpenItem}
              onDeleteItem={onDeleteItem}
              openSwipeableRef={openSwipeableRef}
              swipeableRefs={swipeableRefs}
            />
          )}
          {showDone && (
            <Section
              title="Done"
              items={done}
              emptyText="No recent results."
              onOpenItem={onOpenItem}
              onDeleteItem={onDeleteItem}
              openSwipeableRef={openSwipeableRef}
              swipeableRefs={swipeableRefs}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  filterWrap: { gap: 8 },
  filterLabel: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#666666' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: { backgroundColor: '#FF6B35' },
  filterChipText: { fontFamily: 'Inter', fontSize: 13, color: '#DDDDDD' },
  filterChipTextActive: { fontWeight: '600', color: '#FFFFFF' },
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
  deleteAction: {
    width: 80,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#FF4444',
  },
  deleteText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FF4444' },
  partialFailure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    padding: 12,
  },
  partialFailureText: { flex: 1, fontFamily: 'Inter', fontSize: 12, color: '#DDDDDD' },
  partialFailureRetry: { fontFamily: 'Inter', fontSize: 12, fontWeight: '700', color: '#FF6B35' },
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
  retryButton: {
    marginTop: 18,
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: '#FF6B35',
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
});

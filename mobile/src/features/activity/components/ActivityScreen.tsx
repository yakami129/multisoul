import { ChevronRight, CircleCheck, MessageCircle, SlidersHorizontal } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { activityScreenStyles as s } from './activityScreenStyles';

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
  readAt?: number | null;
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
  isLoadingMore?: boolean;
  hasMore?: boolean;
  loadMoreError?: string | null;
  onRefresh?: () => void;
  onLoadMore?: () => void;
  onRetryLoadMore?: () => void;
  onFilterChange?: () => void;
  onRetry?: () => void;
  onOpenItem: (item: ActivityItem) => void;
  onMarkAllDoneRead?: () => void;
  onDeleteItem?: (item: ActivityItem) => void;
}

type ActivityFilter = 'all' | 'pending' | 'running' | 'done';
type DoneFilter = 'unread' | 'read';

const FILTERS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
];

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function byNewest(a: ActivityItem, b: ActivityItem): number {
  return b.timestamp - a.timestamp;
}

function rowDotStyle(item: ActivityItem) {
  if (item.section === 'running') return s.dotRunning;
  if (item.tone === 'failed') return s.dotFailed;
  if (item.section === 'done' && item.readAt != null) return s.dotRead;
  return s.dotAttention;
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

function ActivityRow({
  item,
  onOpenItem,
  onDeleteItem,
  openSwipeableRef,
  swipeableRefs,
}: {
  item: ActivityItem;
  onOpenItem: (item: ActivityItem) => void;
  onDeleteItem?: (item: ActivityItem) => void;
  openSwipeableRef: React.MutableRefObject<Swipeable | null>;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable>>;
}) {
  const isUnreadDone = item.section === 'done' && item.readAt == null;
  const renderDeleteAction = () => (
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
    <Swipeable
      ref={(ref) => {
        if (ref) swipeableRefs.current.set(item.id, ref);
        else swipeableRefs.current.delete(item.id);
      }}
      onSwipeableOpen={() => {
        if (openSwipeableRef.current) openSwipeableRef.current.close();
        openSwipeableRef.current = swipeableRefs.current.get(item.id) ?? null;
      }}
      renderRightActions={renderDeleteAction}
      overshootRight={false}
    >
      <TouchableOpacity
        style={s.row}
        onPress={() => onOpenItem(item)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
      >
        <View style={[s.rowDot, rowDotStyle(item)]} />
        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <Text style={[s.itemTitle, isUnreadDone && s.itemTitleUnread]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={s.timeText}>{formatRelativeTime(item.timestamp)}</Text>
          </View>
          <Text style={s.subtitle} numberOfLines={2}>
            {item.projectName} · {item.subtitle}
          </Text>
        </View>
        <View style={s.rowRight}>
          <Text
            style={[
              s.statusLabel,
              item.section === 'running' && s.statusRunning,
              item.tone === 'failed' && s.statusFailed,
            ]}
          >
            {item.statusLabel}
          </Text>
          <ChevronRight size={16} color="#555555" />
        </View>
      </TouchableOpacity>
    </Swipeable>
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
  isLoadingMore = false,
  hasMore = false,
  loadMoreError = null,
  onRefresh,
  onLoadMore,
  onRetryLoadMore,
  onFilterChange,
  onRetry,
  onOpenItem,
  onMarkAllDoneRead,
  onDeleteItem,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>('all');
  const [doneFilter, setDoneFilter] = useState<DoneFilter>('unread');
  const listRef = useRef<FlatList<ActivityItem> | null>(null);
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const unreadDone = done.filter((item) => item.readAt == null);
  const readDone = done.filter((item) => item.readAt != null);
  const totalCount = needsAttention.length + running.length + done.length;
  const allItems = [...needsAttention, ...running, ...done].sort(byNewest);

  const tabCount = (filter: ActivityFilter) => {
    if (filter === 'all') return totalCount;
    if (filter === 'pending') return needsAttention.length;
    if (filter === 'running') return running.length;
    return done.length;
  };

  const visibleItems =
    activeFilter === 'all'
      ? allItems
      : activeFilter === 'pending'
        ? needsAttention
        : activeFilter === 'running'
          ? running
          : doneFilter === 'unread'
            ? unreadDone
            : readDone;

  const emptyText =
    activeFilter === 'pending'
      ? 'No pending decisions.'
      : activeFilter === 'running'
        ? 'No active sessions.'
        : activeFilter === 'done'
          ? 'No recent results.'
          : 'No activity.';

  const renderListHeader = () => (
    <>
      <PartialFailureBanner failedEndpointLabels={failedEndpointLabels} onRetry={onRetry} />
      {activeFilter === 'done' ? (
        <View style={s.doneHeader}>
          <View style={s.doneSegment}>
            {(['unread', 'read'] as const).map((filter) => {
              const selected = doneFilter === filter;
              const count = filter === 'unread' ? unreadDone.length : readDone.length;
              const label = filter === 'unread' ? 'Unread' : 'Read';
              return (
                <TouchableOpacity
                  key={filter}
                  style={[s.doneSegmentItem, selected && s.doneSegmentItemActive]}
                  onPress={() => setDoneFilter(filter)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[s.doneSegmentText, selected && s.doneSegmentTextActive]}>
                    {label} {count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {doneFilter === 'unread' && unreadDone.length > 0 ? (
            <TouchableOpacity
              onPress={() => {
                setDoneFilter('read');
                onMarkAllDoneRead?.();
              }}
              accessibilityRole="button"
              accessibilityLabel="Mark all Done items read"
            >
              <Text style={s.markReadText}>Mark All Read</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </>
  );

  const renderListFooter = () => {
    if (isLoadingMore) {
      return (
        <View style={s.loadMoreFooter} accessibilityLiveRegion="polite">
          <ActivityIndicator color="#FF6B35" />
          <Text style={s.loadMoreText}>Loading more activity...</Text>
        </View>
      );
    }
    if (loadMoreError) {
      return (
        <TouchableOpacity
          style={s.loadMoreFooter}
          onPress={onRetryLoadMore}
          accessibilityRole="button"
          accessibilityLabel="Retry loading more activity"
        >
          <Text style={s.loadMoreRetryText}>Load failed. Tap to retry.</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  const handleEndReached = () => {
    if (!hasMore || isLoadingMore || loadMoreError) return;
    onLoadMore?.();
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={s.title}>Activity</Text>
          <SlidersHorizontal size={22} color="#888888" />
        </View>
        <View style={s.segment} testID="activity-filter-segment">
          {FILTERS.map((filter) => {
            const selected = activeFilter === filter.key;
            const count = tabCount(filter.key);
            const doneUnreadSuffix =
              filter.key === 'done' && unreadDone.length > 0 ? `, ${unreadDone.length} unread` : '';
            return (
              <TouchableOpacity
                key={filter.key}
                style={[s.segmentItem, selected && s.segmentItemActive]}
                onPress={() => {
                  if (activeFilter !== filter.key) {
                    onFilterChange?.();
                    listRef.current?.scrollToOffset({ offset: 0, animated: false });
                  }
                  setActiveFilter(filter.key);
                  if (filter.key === 'done') {
                    setDoneFilter(unreadDone.length > 0 ? 'unread' : 'read');
                  }
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Show ${filter.label} activity, ${itemCountLabel(
                  count,
                )}${doneUnreadSuffix}`}
              >
                <Text style={[s.segmentText, selected && s.segmentTextActive]}>
                  {filter.label} {count}
                </Text>
                {filter.key === 'done' && unreadDone.length > 0 ? (
                  <View testID="activity-done-unread-dot" style={s.tabUnreadDot} />
                ) : null}
              </TouchableOpacity>
            );
          })}
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
        <FlatList
          ref={listRef}
          data={visibleItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ActivityRow
              item={item}
              onOpenItem={onOpenItem}
              onDeleteItem={onDeleteItem}
              openSwipeableRef={openSwipeableRef}
              swipeableRefs={swipeableRefs}
            />
          )}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={<Text style={s.emptySectionText}>{emptyText}</Text>}
          ListFooterComponent={renderListFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.2}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews
          style={s.list}
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
          testID="activity-list"
        />
      )}
    </View>
  );
}

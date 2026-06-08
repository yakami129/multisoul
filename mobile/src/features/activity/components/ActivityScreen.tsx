import {
  AlarmClock,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react-native';
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
import { brandColors } from '@/theme/brandRefresh';
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
  workflowId?: string;
  workflowRunId?: string;
  workflowName?: string;
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

const FILTERS: Array<{ key: ActivityFilter; label: string; dot?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending', dot: brandColors.activityOrange },
  { key: 'running', label: 'Running', dot: brandColors.activityCyan },
  { key: 'done', label: 'Done', dot: brandColors.activityLime },
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

// Prototype ticon colors: attention=#ff5b32, running=#15bfe5, done border=#b7d52a fill=#9dc325, failed=error
function toneIconProps(item: ActivityItem): {
  fill: string;
  border: string;
  content: React.ReactNode;
} {
  if (item.section === 'running') {
    return {
      fill: brandColors.activityCyan,
      border: brandColors.activityCyan,
      content: <Clock size={9} color={brandColors.white} />,
    };
  }
  if (item.tone === 'failed') {
    return {
      fill: brandColors.error,
      border: brandColors.error,
      content: <X size={9} color={brandColors.white} />,
    };
  }
  if (item.section === 'done') {
    return {
      fill: brandColors.activityDoneIcon,
      border: brandColors.activityLime,
      content: <Check size={9} color={brandColors.white} />,
    };
  }
  // attention — prototype .ticon default: color #ff5b32
  return {
    fill: brandColors.activityOrange,
    border: brandColors.activityOrange,
    content: <Text style={s.timelineIconText}>!</Text>,
  };
}

// Prototype tag: .tag=orange, .tag.green=done, .tag.blue=running
function tagStyle(item: ActivityItem): { bg: string; color: string } {
  if (item.section === 'running')
    return { bg: brandColors.activityTagBlueBg, color: brandColors.activityTagBlueText };
  if (item.tone === 'failed')
    return { bg: brandColors.activityTagOrangeBg, color: brandColors.activityTagOrangeText };
  if (item.section === 'done')
    return { bg: brandColors.activityTagGreenBg, color: brandColors.activityTagGreenText };
  return { bg: brandColors.activityTagOrangeBg, color: brandColors.activityTagOrangeText };
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

function DecisionBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const label = count === 1 ? 'task needs' : 'tasks need';
  return (
    <TouchableOpacity
      style={s.decisionBanner}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${count} ${label} your decision. Tap to review.`}
    >
      <View style={s.alarmCircle}>
        <AlarmClock size={18} color={brandColors.ink} />
      </View>
      <View style={s.bannerCopy}>
        <Text style={s.bannerTitle}>
          {count} {label} your decision
        </Text>
        <Text style={s.bannerSub}>Your input is needed to keep things moving.</Text>
      </View>
      <View style={s.reviewPill}>
        <Text style={s.reviewPillText}>Review</Text>
        <ChevronRight size={12} color={brandColors.white} />
      </View>
    </TouchableOpacity>
  );
}

function ActivityRow({
  item,
  isFirst,
  isLast,
  onOpenItem,
  onDeleteItem,
  openSwipeableRef,
  swipeableRefs,
}: {
  item: ActivityItem;
  isFirst: boolean;
  isLast: boolean;
  onOpenItem: (item: ActivityItem) => void;
  onDeleteItem?: (item: ActivityItem) => void;
  openSwipeableRef: React.MutableRefObject<Swipeable | null>;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable>>;
}) {
  const icon = toneIconProps(item);
  const tag = tagStyle(item);
  const isUnreadDone = item.section === 'done' && item.readAt == null;
  const displayName = item.workflowName
    ? `${item.agentName || item.projectName} · ${item.workflowName}`
    : item.agentName || item.projectName;

  // Prototype .message-panel (done): rgba(250,255,239,0.88); .tool-panel: rgba(255,252,247,0.78)
  const subBg = item.section === 'done' ? 'rgba(250,255,239,0.88)' : 'rgba(255,252,247,0.78)';

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
    <View style={s.timelineRow}>
      <View style={s.timelineCol}>
        {!isFirst && <View style={s.timelineLineTop} />}
        <View style={[s.timelineIconOuter, { borderColor: icon.border }]}>
          <View style={[s.timelineIconFill, { backgroundColor: icon.fill }]}>{icon.content}</View>
        </View>
        {!isLast && <View style={s.timelineLineBottom} />}
      </View>

      <View style={s.cardWrapper}>
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
            onPress={() => onOpenItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
            activeOpacity={0.85}
          >
            <View style={[s.card, { marginBottom: isLast ? 0 : 10 }]}>
              <View style={[s.cardStrip, { backgroundColor: icon.border }]} />
              <View style={s.cardInner}>
                <Text
                  style={[s.cardTitle, isUnreadDone && { fontWeight: '800' }]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                <View style={s.cardAgent}>
                  <Bot size={10} color="#45464a" />
                  <Text style={s.cardAgentName} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>

                <View style={s.cardTopRight}>
                  <Text style={s.cardTime}>{formatRelativeTime(item.timestamp)}</Text>
                  <View style={[s.tagBadge, { backgroundColor: tag.bg }]}>
                    <Text style={[s.tagText, { color: tag.color }]}>{item.statusLabel}</Text>
                  </View>
                </View>

                {!!item.subtitle && (
                  <View style={[s.subPanel, { backgroundColor: subBg }]}>
                    <View style={s.subPanelInner}>
                      <Text style={s.subPanelText} numberOfLines={2}>
                        {item.subtitle}
                      </Text>
                      {item.section === 'attention' && (
                        <TouchableOpacity
                          style={s.subReviewBtn}
                          onPress={() => onOpenItem(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`Review ${item.title}`}
                        >
                          <Text style={s.subReviewText}>Review</Text>
                          <ChevronRight size={10} color={brandColors.ink} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </Swipeable>
      </View>
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

  const handleFilterPress = (key: ActivityFilter) => {
    if (activeFilter !== key) {
      onFilterChange?.();
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
    setActiveFilter(key);
    if (key === 'done') setDoneFilter(unreadDone.length > 0 ? 'unread' : 'read');
  };

  const renderListHeader = () => (
    <>
      <PartialFailureBanner failedEndpointLabels={failedEndpointLabels} onRetry={onRetry} />
      {activeFilter === 'all' && needsAttention.length > 0 && (
        <DecisionBanner
          count={needsAttention.length}
          onPress={() => handleFilterPress('pending')}
        />
      )}
      {activeFilter === 'done' && (
        <View style={s.doneHeader}>
          <View style={s.doneSegment}>
            {(['unread', 'read'] as const).map((filter) => {
              const selected = doneFilter === filter;
              const count = filter === 'unread' ? unreadDone.length : readDone.length;
              return (
                <TouchableOpacity
                  key={filter}
                  style={[s.doneSegmentItem, selected && s.doneSegmentItemActive]}
                  onPress={() => setDoneFilter(filter)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[s.doneSegmentText, selected && s.doneSegmentTextActive]}>
                    {filter === 'unread' ? 'Unread' : 'Read'} {count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {doneFilter === 'unread' && unreadDone.length > 0 && (
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
          )}
        </View>
      )}
    </>
  );

  const renderListFooter = () => {
    if (isLoadingMore) {
      return (
        <View style={s.loadMoreFooter} accessibilityLiveRegion="polite">
          <ActivityIndicator color={brandColors.activityCyan} />
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

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <View style={s.titleGroup}>
            <View style={s.titleWithSpark}>
              <Text style={s.title}>Activity</Text>
              <View style={s.sparkIcon} pointerEvents="none">
                <Sparkles size={10} color={brandColors.ink} />
              </View>
            </View>
            <Text style={s.titleSub}>Mission log</Text>
          </View>
          <View style={s.filterBtn}>
            <SlidersHorizontal size={17} color={brandColors.ink} />
          </View>
        </View>

        <View style={s.segment} testID="activity-filter-segment">
          {FILTERS.map((filter, idx) => {
            const selected = activeFilter === filter.key;
            const count = tabCount(filter.key);
            const doneUnread = filter.key === 'done' && unreadDone.length > 0;
            return (
              <React.Fragment key={filter.key}>
                {idx > 0 && <View style={s.segDivider} />}
                <TouchableOpacity
                  style={[s.segItem, selected && s.segItemActive]}
                  onPress={() => handleFilterPress(filter.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Show ${filter.label} activity, ${itemCountLabel(count)}${filter.key === 'done' && unreadDone.length > 0 ? `, ${unreadDone.length} unread` : ''}`}
                >
                  {filter.dot && <View style={[s.segDot, { backgroundColor: filter.dot }]} />}
                  <Text style={[s.segItemText, selected && s.segItemTextActive]}>
                    {filter.label} {count}
                  </Text>
                  {doneUnread && <View testID="activity-done-unread-dot" style={s.tabUnreadDot} />}
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </View>
      </View>

      {allFailed ? (
        <ScrollView
          contentContainerStyle={s.emptyBody}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={brandColors.activityCyan}
            />
          }
          testID="activity-scroll"
        >
          <View style={s.emptyIconWrap}>
            <MessageCircle size={30} color={brandColors.error} />
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
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={brandColors.activityCyan}
            />
          }
          testID="activity-scroll"
        >
          <PartialFailureBanner failedEndpointLabels={failedEndpointLabels} onRetry={onRetry} />
          <View style={s.emptyIconWrap}>
            <CircleCheck size={30} color={brandColors.activityLime} />
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
          renderItem={({ item, index }) => (
            <ActivityRow
              item={item}
              isFirst={index === 0}
              isLast={index === visibleItems.length - 1}
              onOpenItem={onOpenItem}
              onDeleteItem={onDeleteItem}
              openSwipeableRef={openSwipeableRef}
              swipeableRefs={swipeableRefs}
            />
          )}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={<Text style={s.emptySectionText}>{emptyText}</Text>}
          ListFooterComponent={renderListFooter}
          onEndReached={() => {
            if (!hasMore || isLoadingMore || loadMoreError) return;
            onLoadMore?.();
          }}
          onEndReachedThreshold={0.2}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews
          style={s.list}
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={brandColors.activityCyan}
            />
          }
          testID="activity-list"
        />
      )}
    </View>
  );
}

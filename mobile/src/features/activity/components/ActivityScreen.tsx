import { CircleCheck, MessageCircle, SlidersHorizontal, Sparkles } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { type Swipeable } from 'react-native-gesture-handler';
import { brandColors } from '@/theme/brandRefresh';
import {
  ACTIVITY_FILTERS,
  byNewest,
  itemCountLabel,
  type ActivityFilter,
  type ActivityItem,
  type DoneFilter,
} from './activityItem';
import { ActivityRow, DecisionBanner, PartialFailureBanner } from './ActivityScreenParts';
import { activityScreenStyles as s } from './activityScreenStyles';

export type { ActivityItem } from './activityItem';

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
  const { t } = useTranslation();
  const filterLabel: Record<
    ActivityFilter,
    | 'activity.filterAll'
    | 'activity.filterPending'
    | 'activity.filterRunning'
    | 'activity.filterDone'
  > = {
    all: 'activity.filterAll',
    pending: 'activity.filterPending',
    running: 'activity.filterRunning',
    done: 'activity.filterDone',
  };
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
      ? t('activity.noPending')
      : activeFilter === 'running'
        ? t('activity.noRunning')
        : activeFilter === 'done'
          ? t('activity.noDone')
          : t('activity.noActivity');

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
        <View testID="activity-done-header" style={s.doneHeader}>
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
                    {filter === 'unread' ? t('activity.unread') : t('activity.read')} {count}
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
              <Text style={s.markReadText}>{t('activity.markAllRead')}</Text>
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
          <Text style={s.loadMoreText}>{t('activity.loadingMore')}</Text>
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
          <Text style={s.loadMoreRetryText}>{t('activity.loadFailed')}</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  const refreshControl = (
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      tintColor={brandColors.activityCyan}
    />
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <View style={s.titleGroup}>
            <View style={s.titleWithSpark}>
              <Text style={s.title}>{t('activity.title')}</Text>
              <View style={s.sparkIcon} pointerEvents="none">
                <Sparkles size={10} color={brandColors.ink} />
              </View>
            </View>
            <Text style={s.titleSub}>{t('activity.missionLog')}</Text>
          </View>
          <View style={s.filterBtn}>
            <SlidersHorizontal size={17} color={brandColors.ink} />
          </View>
        </View>

        <View style={s.segment} testID="activity-filter-segment">
          {ACTIVITY_FILTERS.map((filter, idx) => {
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
                  accessibilityLabel={`Show ${t(filterLabel[filter.key])} activity, ${itemCountLabel(count)}${filter.key === 'done' && unreadDone.length > 0 ? `, ${unreadDone.length} unread` : ''}`}
                >
                  {filter.dot && <View style={[s.segDot, { backgroundColor: filter.dot }]} />}
                  <Text style={[s.segItemText, selected && s.segItemTextActive]}>
                    {t(filterLabel[filter.key])} {count}
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
          refreshControl={refreshControl}
          testID="activity-scroll"
        >
          <View style={s.emptyIconWrap}>
            <MessageCircle size={30} color={brandColors.error} />
          </View>
          <Text style={s.emptyTitle}>{t('activity.couldNotLoad')}</Text>
          <Text style={s.emptyDesc}>{t('activity.allEndpointsFailed')}</Text>
          <TouchableOpacity
            style={s.retryButton}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry activity"
          >
            <Text style={s.retryText}>{t('activity.retry')}</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : totalCount === 0 ? (
        <ScrollView
          contentContainerStyle={s.emptyBody}
          refreshControl={refreshControl}
          testID="activity-scroll"
        >
          <PartialFailureBanner failedEndpointLabels={failedEndpointLabels} onRetry={onRetry} />
          <View style={s.emptyIconWrap}>
            <CircleCheck size={30} color={brandColors.activityLime} />
          </View>
          <Text style={s.emptyTitle}>
            {hasEndpoints ? t('activity.allCaughtUp') : t('activity.connectEndpoint')}
          </Text>
          <Text style={s.emptyDesc}>
            {hasEndpoints ? t('activity.nothingPending') : t('activity.addEndpointInSettings')}
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
          refreshControl={refreshControl}
          testID="activity-list"
        />
      )}
    </View>
  );
}

import { Plus } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { FlatList, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Workflow, type WatchStatus } from '../types';
import { workflowScreenStyles as s } from './workflowScreenStyles';

type FilterTab = 'all' | 'active' | 'ended';

const WATCH_STATUS_LABEL: Record<WatchStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  stopped: 'Stopped',
  expired: 'Expired',
  failed: 'Failed',
};

function formatNextRun(nextRunAt: number | null): string {
  if (!nextRunAt) return 'Disabled';
  const diff = nextRunAt - Date.now();
  if (diff <= 0) return 'Due now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

function workflowKey(workflow: Workflow): string {
  return `${workflow.endpoint_id}:${workflow.id}`;
}

function isWorkflowVisible(workflow: Workflow, filter: FilterTab): boolean {
  if (filter === 'all') return true;
  if (workflow.mode === 'watch') {
    if (filter === 'active') return workflow.watch_status === 'active';
    if (filter === 'ended') {
      return (
        workflow.watch_status === 'completed' ||
        workflow.watch_status === 'stopped' ||
        workflow.watch_status === 'expired' ||
        workflow.watch_status === 'failed'
      );
    }
    return false;
  }
  // recurring
  if (filter === 'active') return workflow.enabled;
  if (filter === 'ended') return false;
  return true;
}

interface Props {
  workflows: Workflow[];
  hasEndpoints?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onCreateWorkflow: () => void;
  onToggleEnabled: (workflowId: string, enabled: boolean, endpointId: string) => void;
  onOpenWorkflow: (workflow: Workflow) => void;
  onEditWorkflow?: (workflow: Workflow) => void;
  onDeleteWorkflow?: (workflow: Workflow) => void;
}

export function WorkflowListScreen({
  workflows,
  hasEndpoints = true,
  onCreateWorkflow,
  onToggleEnabled,
  onOpenWorkflow,
  onEditWorkflow,
  onDeleteWorkflow,
}: Props) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterTab>('all');
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const visibleWorkflows = workflows.filter((wf) => isWorkflowVisible(wf, filter));

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Workflows</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="New Workflow"
          disabled={!hasEndpoints}
          onPress={onCreateWorkflow}
          style={s.addButton}
        >
          <Plus size={20} color={hasEndpoints ? brandColors.ink : brandColors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={ds.filterRow}>
        {(['all', 'active', 'ended'] as FilterTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[ds.filterChip, filter === tab && ds.filterChipActive]}
            onPress={() => setFilter(tab)}
            accessibilityRole="button"
            testID={`workflow-filter-${tab}`}
          >
            <Text style={[ds.filterChipText, filter === tab && ds.filterChipTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {visibleWorkflows.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={s.emptyText}>
            {filter === 'ended' ? 'No ended watches' : 'No workflows yet'}
          </Text>
          <Text style={s.emptySubtext}>
            {hasEndpoints
              ? filter === 'ended'
                ? 'Completed, stopped, or expired watches appear here'
                : 'Tap + to create a scheduled workflow'
              : 'Add an endpoint in Settings first'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleWorkflows}
          keyExtractor={(item) => `${item.endpoint_id}:${item.id}`}
          contentContainerStyle={s.listContent}
          renderItem={({ item }) => (
            <Swipeable
              ref={(ref) => {
                if (ref) swipeableRefs.current.set(workflowKey(item), ref);
                else swipeableRefs.current.delete(workflowKey(item));
              }}
              onSwipeableOpen={() => {
                if (openSwipeableRef.current) openSwipeableRef.current.close();
                openSwipeableRef.current = swipeableRefs.current.get(workflowKey(item)) ?? null;
              }}
              overshootRight={false}
              renderRightActions={() => (
                <View style={ds.actions}>
                  {onEditWorkflow ? (
                    <TouchableOpacity
                      style={ds.editAction}
                      onPress={() => {
                        swipeableRefs.current.get(workflowKey(item))?.close();
                        onEditWorkflow(item);
                      }}
                      accessibilityLabel={`Edit ${item.name}`}
                    >
                      <Text style={ds.editText}>EDIT</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={ds.deleteAction}
                    onPress={() => {
                      swipeableRefs.current.get(workflowKey(item))?.close();
                      onDeleteWorkflow?.(item);
                    }}
                    accessibilityLabel={`Delete ${item.name}`}
                  >
                    <Text style={ds.deleteText}>DELETE</Text>
                  </TouchableOpacity>
                </View>
              )}
            >
              {item.mode === 'watch' ? (
                <TouchableOpacity
                  style={[s.row, isWatchEnded(item.watch_status) && ds.rowDim]}
                  onPress={() => onOpenWorkflow(item)}
                  accessibilityRole="button"
                >
                  <View style={s.rowInfo}>
                    <View style={ds.rowNameRow}>
                      <Text style={s.rowName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={ds.watchBadge}>
                        <Text style={ds.watchBadgeText}>WATCH</Text>
                      </View>
                      {item.watch_status ? (
                        <View
                          style={[
                            ds.statusBadge,
                            item.watch_status === 'active' ? ds.statusActive : ds.statusEnded,
                          ]}
                        >
                          <Text style={ds.statusBadgeText}>
                            {WATCH_STATUS_LABEL[item.watch_status]}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.rowMeta} numberOfLines={1}>
                      {item.endpoint_label} · Every {item.interval_minutes ?? '?'} min ·{' '}
                      {item.watch_status === 'active'
                        ? formatNextRun(item.next_run_at)
                        : (item.watch_status ?? '—')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={s.row}
                  onPress={() => onOpenWorkflow(item)}
                  accessibilityRole="button"
                >
                  <View style={s.rowInfo}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={s.rowMeta} numberOfLines={1}>
                      {item.endpoint_label} · {item.schedule_kind} {item.time_of_day} ·{' '}
                      {formatNextRun(item.next_run_at)}
                    </Text>
                  </View>
                  <Switch
                    testID={`workflow-toggle-${item.id}`}
                    value={item.enabled}
                    onValueChange={(val) => onToggleEnabled(item.id, val, item.endpoint_id)}
                    trackColor={{ false: brandRgba.ink18, true: brandColors.cyan }}
                    thumbColor={brandColors.white}
                  />
                </TouchableOpacity>
              )}
            </Swipeable>
          )}
        />
      )}
    </View>
  );
}

function isWatchEnded(watchStatus: string | null | undefined): boolean {
  return (
    watchStatus === 'completed' ||
    watchStatus === 'stopped' ||
    watchStatus === 'expired' ||
    watchStatus === 'failed'
  );
}

const ds = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
  },
  filterChipActive: {
    backgroundColor: brandColors.ink,
    borderColor: brandColors.ink,
  },
  filterChipText: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: brandColors.textSoft,
  },
  filterChipTextActive: {
    color: brandColors.white,
  },
  actions: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  editAction: {
    width: 66,
    backgroundColor: brandRgba.white88,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: brandColors.coral,
  },
  deleteAction: {
    width: 74,
    backgroundColor: brandColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: brandColors.error,
  },
  editText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: brandColors.coral },
  deleteText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: brandColors.error },
  rowDim: { opacity: 0.55 },
  rowNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  watchBadge: {
    backgroundColor: brandRgba.coralSoft,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  watchBadgeText: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '700',
    color: brandColors.coral,
    letterSpacing: 0.5,
  },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  statusActive: { backgroundColor: brandRgba.cyanSoft },
  statusEnded: { backgroundColor: brandRgba.white88 },
  statusBadgeText: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '600',
    color: brandColors.textSoft,
  },
});

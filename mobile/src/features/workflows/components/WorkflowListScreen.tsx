import { Plus } from 'lucide-react-native';
import React, { useRef } from 'react';
import { FlatList, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Workflow } from '../types';
import { workflowScreenStyles as s } from './workflowScreenStyles';

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
  const openSwipeableRef = useRef<Swipeable | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

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

      {workflows.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={s.emptyText}>No workflows yet</Text>
          <Text style={s.emptySubtext}>
            {hasEndpoints
              ? 'Tap + to create a scheduled workflow'
              : 'Add an endpoint in Settings first'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={workflows}
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
            </Swipeable>
          )}
        />
      )}
    </View>
  );
}

const ds = StyleSheet.create({
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
});

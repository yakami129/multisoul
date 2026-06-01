import { Plus } from 'lucide-react-native';
import React from 'react';
import { FlatList, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

interface Props {
  workflows: Workflow[];
  hasEndpoints?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onCreateWorkflow: () => void;
  onToggleEnabled: (workflowId: string, enabled: boolean, endpointId: string) => void;
  onOpenWorkflow: (workflow: Workflow) => void;
}

export function WorkflowListScreen({
  workflows,
  hasEndpoints = true,
  onCreateWorkflow,
  onToggleEnabled,
  onOpenWorkflow,
}: Props) {
  const insets = useSafeAreaInsets();

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
          <Plus size={24} color={hasEndpoints ? '#FF6B35' : '#555555'} />
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
            <TouchableOpacity
              style={s.row}
              onPress={() => onOpenWorkflow(item)}
              accessibilityRole="button"
            >
              <View style={s.rowInfo}>
                <Text style={s.rowName}>{item.name}</Text>
                <Text style={s.rowMeta}>
                  {item.endpoint_label} · {item.schedule_kind} {item.time_of_day} ·{' '}
                  {formatNextRun(item.next_run_at)}
                </Text>
              </View>
              <Switch
                testID={`workflow-toggle-${item.id}`}
                value={item.enabled}
                onValueChange={(val) => onToggleEnabled(item.id, val, item.endpoint_id)}
                trackColor={{ false: '#333333', true: '#FF6B35' }}
                thumbColor="#FFFFFF"
              />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

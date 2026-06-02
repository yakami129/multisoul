import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import { fetchWorkflows, fetchWorkflowRuns } from '@/features/workflows/services/workflowService';
import { type Workflow, type WorkflowRun } from '@/features/workflows/types';
import { useEndpointStore } from '@/store/endpointStore';

const DOT_COLOR: Record<string, string> = {
  running: '#FF6B35',
  completed: '#4CAF50',
  failed: '#FF4444',
  skipped_overlap: '#555555',
};

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  skipped_overlap: 'Skipped Overlap',
};

function formatNextRun(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday
    ? `Today ${time}`
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function formatRunTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday
    ? `Today ${time}`
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export default function WorkflowDetailRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const idParam = params.id;
  const workflowId = Array.isArray(idParam)
    ? idParam[0]
    : typeof idParam === 'string'
      ? idParam
      : undefined;
  const endpoints = useEndpointStore((s) => s.endpoints);

  const { data: workflow, isLoading } = useQuery<Workflow | undefined>({
    queryKey: ['workflow', workflowId, endpoints.map((e) => e.id)],
    queryFn: async () => {
      const results = await Promise.allSettled(endpoints.map((ep) => fetchWorkflows(ep)));
      const all = results
        .filter((r): r is PromiseFulfilledResult<Workflow[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value);
      return all.find((w) => w.id === workflowId);
    },
    enabled: !!workflowId && endpoints.length > 0,
  });

  const { data: runs = [] } = useQuery<WorkflowRun[]>({
    queryKey: ['workflow-runs', workflowId, workflow?.endpoint_id],
    queryFn: async () => {
      if (!workflow) return [];
      const ep = endpoints.find((e) => e.id === workflow.endpoint_id);
      if (!ep) return [];
      return fetchWorkflowRuns(ep, workflow.id);
    },
    enabled: !!workflow,
    refetchInterval: 15_000,
  });

  const scheduleLabel =
    workflow?.schedule_kind === 'weekly'
      ? `Weekly at ${workflow.time_of_day}`
      : `Daily at ${workflow?.time_of_day ?? '—'}`;

  const promptPreview = workflow?.prompt
    ? workflow.prompt.length > 40
      ? workflow.prompt.slice(0, 40) + '...'
      : workflow.prompt
    : '—';

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          style={s.headerSide}
        >
          <Text style={s.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Workflow Detail</Text>
        <View style={s.headerSide} />
      </View>

      {isLoading ? (
        <ActivityIndicator color="#FF6B35" style={{ marginTop: 48 }} />
      ) : !workflow ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>Workflow not found</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}>
          {/* Identity card */}
          <View style={s.identityCard}>
            <View style={s.agentIcon}>
              <Text style={s.agentIconText}>▦</Text>
            </View>
            <View style={s.identityInfo}>
              <Text style={s.workflowName}>{workflow.name}</Text>
              <Text style={s.agentName}>{workflow.endpoint_label}</Text>
            </View>
            <View style={[s.toggle, workflow.enabled ? s.toggleOn : s.toggleOff]}>
              <View style={[s.toggleThumb, workflow.enabled ? s.thumbRight : s.thumbLeft]} />
            </View>
          </View>

          {/* Info card */}
          <View style={s.infoCard}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Next Run</Text>
              <Text style={s.infoValue}>{formatNextRun(workflow.next_run_at)}</Text>
            </View>
            <View style={s.divider} />
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Schedule</Text>
              <Text style={s.infoValue}>{scheduleLabel}</Text>
            </View>
            <View style={s.divider} />
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Prompt</Text>
              <Text style={s.infoValue}>{promptPreview}</Text>
            </View>
          </View>

          {/* Recent Runs */}
          <Text style={s.sectionHeader}>RECENT RUNS</Text>
          {runs.length === 0 ? (
            <Text style={s.noRuns}>No runs yet</Text>
          ) : (
            <View style={s.runsCard}>
              {runs.map((run, idx) => {
                const isLast = idx === runs.length - 1;
                const canOpen = !!run.conversation_id;
                return (
                  <View key={run.id}>
                    <View style={s.runRow}>
                      <View
                        style={[s.dot, { backgroundColor: DOT_COLOR[run.status] ?? '#555555' }]}
                      />
                      <View style={s.runInfo}>
                        <Text style={s.runStatus}>{STATUS_LABEL[run.status] ?? run.status}</Text>
                        <Text style={s.runTime}>{formatRunTime(run.scheduled_for)}</Text>
                        {run.error_message ? (
                          <Text style={s.runError} numberOfLines={2}>
                            {run.error_message}
                          </Text>
                        ) : null}
                      </View>
                      {canOpen ? (
                        <TouchableOpacity
                          onPress={() =>
                            router.push(
                              buildChatDetailPath({
                                conversationId: run.conversation_id!,
                                endpointId: run.endpoint_id,
                              }) as `/${string}`,
                            )
                          }
                          accessibilityRole="button"
                        >
                          <Text style={s.openLink}>Open Conversation</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={s.noConv}>No conversation</Text>
                      )}
                    </View>
                    {!isLast && <View style={s.divider} />}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerSide: { width: 48 },
  backChevron: { fontFamily: 'Inter', fontSize: 22, color: '#DDDDDD' },
  headerTitle: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  // Identity card
  identityCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  agentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  agentIconText: { fontSize: 18, color: '#FF6B35' },
  identityInfo: { flex: 1 },
  workflowName: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  agentName: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: '#FF6B35' },
  toggleOff: { backgroundColor: '#2A2A2A' },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  thumbRight: { alignSelf: 'flex-end' },
  thumbLeft: { alignSelf: 'flex-start' },
  // Info card
  infoCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  infoLabel: { fontFamily: 'Inter', fontSize: 14, color: '#DDDDDD' },
  infoValue: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#888888',
    maxWidth: '60%',
    textAlign: 'right',
  },
  divider: { height: 1, backgroundColor: '#2A2A2A' },
  // Section header
  sectionHeader: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '700',
    color: '#888888',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  noRuns: { fontFamily: 'Inter', fontSize: 14, color: '#555555' },
  // Runs card
  runsCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  runRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    marginRight: 12,
  },
  runInfo: { flex: 1 },
  runStatus: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  runTime: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  runError: { fontFamily: 'Inter', fontSize: 12, color: '#FF4444', marginTop: 2 },
  openLink: { fontFamily: 'Inter', fontSize: 12, color: '#FF6B35' },
  noConv: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: 'Inter', fontSize: 15, color: '#888888' },
});

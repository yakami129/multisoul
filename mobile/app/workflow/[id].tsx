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
import { brandColors, brandRgba } from '@/theme/brandRefresh';

const DOT_COLOR: Record<string, string> = {
  running: brandColors.cyan,
  completed: brandColors.lime,
  failed: brandColors.error,
  skipped_overlap: brandColors.textMuted,
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
        <ActivityIndicator color={brandColors.cyan} style={{ marginTop: 48 }} />
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
              <Text style={s.workflowName} numberOfLines={1}>
                {workflow.name}
              </Text>
              <Text style={s.agentName} numberOfLines={1}>
                {workflow.endpoint_label}
              </Text>
            </View>
            <View style={[s.toggle, workflow.enabled ? s.toggleOn : s.toggleOff]}>
              <View style={[s.toggleThumb, workflow.enabled ? s.thumbRight : s.thumbLeft]} />
            </View>
          </View>

          {/* Info card */}
          <View style={s.infoCard}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Next Run</Text>
              <Text style={s.infoValue} numberOfLines={1}>
                {formatNextRun(workflow.next_run_at)}
              </Text>
            </View>
            <View style={s.divider} />
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Schedule</Text>
              <Text style={s.infoValue} numberOfLines={1}>
                {scheduleLabel}
              </Text>
            </View>
            <View style={s.divider} />
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Prompt</Text>
              <Text style={s.infoValue} numberOfLines={1}>
                {promptPreview}
              </Text>
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
                        style={[
                          s.dot,
                          { backgroundColor: DOT_COLOR[run.status] ?? brandColors.textMuted },
                        ]}
                      />
                      <View style={s.runInfo}>
                        <Text style={s.runStatus} numberOfLines={1}>
                          {STATUS_LABEL[run.status] ?? run.status}
                        </Text>
                        <Text style={s.runTime} numberOfLines={1}>
                          {formatRunTime(run.scheduled_for)}
                        </Text>
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
                          <Text style={s.openLink} numberOfLines={1}>
                            Open Conversation
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={s.noConv} numberOfLines={1}>
                          No conversation
                        </Text>
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
  root: { flex: 1, backgroundColor: brandColors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 52,
  },
  headerSide: { width: 48 },
  backChevron: { fontFamily: 'Inter', fontSize: 20, color: brandColors.ink },
  headerTitle: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '700',
    color: brandColors.ink,
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  // Identity card
  identityCard: {
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  agentIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: brandRgba.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  agentIconText: { fontSize: 14, color: brandColors.coral },
  identityInfo: { flex: 1, minWidth: 0 },
  workflowName: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: brandColors.ink,
    marginBottom: 2,
  },
  agentName: { fontFamily: 'Inter', fontSize: 11, color: brandColors.textSoft },
  toggle: {
    width: 38,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: brandColors.cyan },
  toggleOff: { backgroundColor: brandRgba.ink18 },
  toggleThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: brandColors.white,
  },
  thumbRight: { alignSelf: 'flex-end' },
  thumbLeft: { alignSelf: 'flex-start' },
  // Info card
  infoCard: {
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
  },
  infoLabel: { fontFamily: 'Inter', fontSize: 12, color: brandColors.ink },
  infoValue: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textSoft,
    maxWidth: '60%',
    textAlign: 'right',
  },
  divider: { height: 1, backgroundColor: brandRgba.silver78 },
  // Section header
  sectionHeader: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '700',
    color: brandColors.textSoft,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  noRuns: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textMuted },
  // Runs card
  runsCard: {
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  runRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 11,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 4,
    marginRight: 9,
  },
  runInfo: { flex: 1, minWidth: 0 },
  runStatus: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: brandColors.ink,
    marginBottom: 2,
  },
  runTime: { fontFamily: 'Inter', fontSize: 11, color: brandColors.textSoft },
  runError: { fontFamily: 'Inter', fontSize: 11, color: brandColors.error, marginTop: 2 },
  openLink: {
    maxWidth: 96,
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.coral,
    textAlign: 'right',
  },
  noConv: {
    maxWidth: 88,
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.textMuted,
    textAlign: 'right',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: 'Inter', fontSize: 13, color: brandColors.textSoft },
});

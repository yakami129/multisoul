import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import { buildChatDetailPath } from '@/features/chat/utils/chatRoutes';
import {
  WorkflowRunsCard,
  WorkflowWatchCard,
} from '@/features/workflows/components/WorkflowDetailCards';
import {
  WorkflowFormScreen,
  type WorkflowFormInitialValues,
} from '@/features/workflows/components/WorkflowFormScreen';
import {
  fetchWorkflows,
  fetchWorkflowRuns,
  updateWorkflow,
  stopWatch,
  restartWatch,
} from '@/features/workflows/services/workflowService';
import { type Workflow, type WorkflowInput, type WorkflowRun } from '@/features/workflows/types';
import { useEndpointStore } from '@/store/endpointStore';
import { brandColors, brandRgba } from '@/theme/brandRefresh';

function formatNextRun(ts: number | null, todayLabel: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday
    ? `${todayLabel} ${time}`
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function workflowToFormValues(wf: Workflow): WorkflowFormInitialValues {
  return {
    name: wf.name,
    agent_id: wf.agent_id,
    prompt: wf.prompt,
    mode: wf.mode,
    schedule_kind: wf.schedule_kind,
    time_of_day: wf.time_of_day,
    day_of_week: wf.day_of_week,
    interval_minutes: wf.interval_minutes,
    max_runs: wf.max_runs,
    expires_at: wf.expires_at,
    stop_condition: wf.stop_condition,
  };
}

export default function WorkflowDetailRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [showEdit, setShowEdit] = useState(false);
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

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', endpoints.map((e) => e.id), 'workflow-detail'],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  const updateMutation = useMutation({
    mutationFn: async (input: WorkflowInput) => {
      if (!workflow) throw new Error('Workflow not found');
      const ep = endpoints.find((e) => e.id === workflow.endpoint_id);
      if (!ep) throw new Error('Endpoint not found');
      await updateWorkflow(ep, workflow.id, input);
    },
    onSuccess: () => {
      setShowEdit(false);
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
  });

  const stopWatchMutation = useMutation({
    mutationFn: async () => {
      if (!workflow) throw new Error('Workflow not found');
      const ep = endpoints.find((e) => e.id === workflow.endpoint_id);
      if (!ep) throw new Error('Endpoint not found');
      await stopWatch(ep, workflow.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
  });

  const restartWatchMutation = useMutation({
    mutationFn: async () => {
      if (!workflow) throw new Error('Workflow not found');
      const ep = endpoints.find((e) => e.id === workflow.endpoint_id);
      if (!ep) throw new Error('Endpoint not found');
      await restartWatch(ep, workflow.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
  });

  const editAgents = workflow
    ? agents.filter((agent) => agent.endpoint_id === workflow.endpoint_id)
    : [];

  const scheduleLabel =
    workflow?.mode === 'watch'
      ? t('workflows.everyNMin', { n: workflow.interval_minutes ?? '?' })
      : workflow?.schedule_kind === 'weekly'
        ? t('workflows.scheduleWeeklyAt', { time: workflow.time_of_day })
        : t('workflows.scheduleDailyAt', { time: workflow?.time_of_day ?? '—' });

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
        <Text style={s.headerTitle}>{t('workflows.detailTitle')}</Text>
        {workflow ? (
          <TouchableOpacity
            onPress={() => setShowEdit(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit Workflow"
            style={s.headerSide}
          >
            <Text style={s.headerEditText}>{t('workflows.detailEdit')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.headerSide} />
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color={brandColors.cyan} style={{ marginTop: 48 }} />
      ) : !workflow ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>{t('workflows.notFound')}</Text>
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
              <Text style={s.infoLabel}>{t('workflows.infoNextRun')}</Text>
              <Text style={s.infoValue} numberOfLines={1}>
                {formatNextRun(workflow.next_run_at, t('workflows.today'))}
              </Text>
            </View>
            <View style={s.divider} />
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>{t('workflows.infoSchedule')}</Text>
              <Text style={s.infoValue} numberOfLines={1}>
                {scheduleLabel}
              </Text>
            </View>
            <View style={s.divider} />
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>{t('workflows.infoPrompt')}</Text>
              <Text style={s.infoValue} numberOfLines={1}>
                {promptPreview}
              </Text>
            </View>
          </View>

          {/* Watch controls */}
          {workflow.mode === 'watch' ? (
            <WorkflowWatchCard
              workflow={workflow}
              stopWatchPending={stopWatchMutation.isPending}
              restartWatchPending={restartWatchMutation.isPending}
              onStopWatch={() => stopWatchMutation.mutate()}
              onRestartWatch={() => restartWatchMutation.mutate()}
            />
          ) : null}

          {/* Recent Runs */}
          <Text style={s.sectionHeader}>{t('workflows.recentRuns')}</Text>
          {runs.length === 0 ? (
            <Text style={s.noRuns}>{t('workflows.noRuns')}</Text>
          ) : (
            <WorkflowRunsCard
              runs={runs}
              onOpenConversation={(run) =>
                router.push(
                  buildChatDetailPath({
                    conversationId: run.conversation_id!,
                    endpointId: run.endpoint_id,
                  }) as `/${string}`,
                )
              }
            />
          )}
        </ScrollView>
      )}
      <Modal
        visible={showEdit && !!workflow}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEdit(false)}
      >
        <View style={{ flex: 1, backgroundColor: brandColors.cream }}>
          {showEdit && workflow ? (
            <WorkflowFormScreen
              key={`edit-${workflow.endpoint_id}-${workflow.id}-${workflow.updated_at}`}
              agents={editAgents}
              initialValues={workflowToFormValues(workflow)}
              title={t('workflows.titleEdit')}
              onSave={(input) => updateMutation.mutate(input)}
              onCancel={() => setShowEdit(false)}
            />
          ) : null}
        </View>
      </Modal>
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
  headerEditText: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '600',
    color: brandColors.coral,
    textAlign: 'right',
  },
  headerTitle: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '700',
    color: brandColors.ink,
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
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
  sectionHeader: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '700',
    color: brandColors.textSoft,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  noRuns: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textMuted },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: 'Inter', fontSize: 13, color: brandColors.textSoft },
});

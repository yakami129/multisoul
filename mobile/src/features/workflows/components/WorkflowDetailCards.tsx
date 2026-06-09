import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Workflow, type WorkflowRun } from '../types';

const DOT_COLOR: Record<string, string> = {
  running: brandColors.cyan,
  completed: brandColors.lime,
  failed: brandColors.error,
  skipped_overlap: brandColors.textMuted,
};

type RunStatusKey =
  | 'workflows.runStatusRunning'
  | 'workflows.runStatusCompleted'
  | 'workflows.runStatusFailed'
  | 'workflows.runStatusSkipped';
const RUN_STATUS_KEY: Record<string, RunStatusKey> = {
  running: 'workflows.runStatusRunning',
  completed: 'workflows.runStatusCompleted',
  failed: 'workflows.runStatusFailed',
  skipped_overlap: 'workflows.runStatusSkipped',
};

type WatchStatusDetailKey =
  | 'workflows.statusActive'
  | 'workflows.statusCompleted'
  | 'workflows.statusStopped'
  | 'workflows.statusExpired'
  | 'workflows.statusFailed';
const WATCH_STATUS_KEY: Record<string, WatchStatusDetailKey> = {
  active: 'workflows.statusActive',
  completed: 'workflows.statusCompleted',
  stopped: 'workflows.statusStopped',
  expired: 'workflows.statusExpired',
  failed: 'workflows.statusFailed',
};

function formatNextRunOrExpiry(ts: number | null, todayLabel: string): string {
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

interface WatchCardProps {
  workflow: Workflow;
  stopWatchPending: boolean;
  restartWatchPending: boolean;
  onStopWatch: () => void;
  onRestartWatch: () => void;
}

export function WorkflowWatchCard({
  workflow,
  stopWatchPending,
  restartWatchPending,
  onStopWatch,
  onRestartWatch,
}: WatchCardProps) {
  const { t } = useTranslation();
  const todayLabel = t('workflows.today');
  return (
    <>
      <View style={cs.infoCard}>
        <View style={cs.infoRow}>
          <Text style={cs.infoLabel}>{t('workflows.infoStatus')}</Text>
          <Text style={[cs.infoValue, workflow.watch_status === 'active' && cs.watchActive]}>
            {workflow.watch_status
              ? t(WATCH_STATUS_KEY[workflow.watch_status] ?? 'workflows.statusFailed')
              : '—'}
          </Text>
        </View>
        <View style={cs.divider} />
        <View style={cs.infoRow}>
          <Text style={cs.infoLabel}>{t('workflows.infoRuns')}</Text>
          <Text style={cs.infoValue}>
            {workflow.run_count}
            {workflow.max_runs ? ` / ${workflow.max_runs}` : ''}
          </Text>
        </View>
        {workflow.expires_at ? (
          <>
            <View style={cs.divider} />
            <View style={cs.infoRow}>
              <Text style={cs.infoLabel}>{t('workflows.infoExpires')}</Text>
              <Text style={cs.infoValue}>
                {formatNextRunOrExpiry(workflow.expires_at, todayLabel)}
              </Text>
            </View>
          </>
        ) : null}
        {workflow.stop_condition ? (
          <>
            <View style={cs.divider} />
            <View style={[cs.infoRow, { alignItems: 'flex-start' }]}>
              <Text style={cs.infoLabel}>{t('workflows.infoStopCondition')}</Text>
              <Text style={[cs.infoValue, { maxWidth: '55%' }]} numberOfLines={3}>
                {workflow.stop_condition}
              </Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={cs.watchActions}>
        {workflow.watch_status === 'active' ? (
          <TouchableOpacity
            style={[cs.watchBtn, cs.watchBtnStop]}
            onPress={onStopWatch}
            disabled={stopWatchPending}
            accessibilityRole="button"
            accessibilityLabel="Stop Watch"
          >
            <Text style={cs.watchBtnText}>{t('workflows.stopWatch')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[cs.watchBtn, cs.watchBtnRestart]}
            onPress={onRestartWatch}
            disabled={restartWatchPending}
            accessibilityRole="button"
            accessibilityLabel="Restart Watch"
          >
            <Text style={cs.watchBtnText}>{t('workflows.restartWatch')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );
}

interface RunsCardProps {
  runs: WorkflowRun[];
  onOpenConversation: (run: WorkflowRun) => void;
}

export function WorkflowRunsCard({ runs, onOpenConversation }: RunsCardProps) {
  const { t } = useTranslation();
  const todayLabel = t('workflows.today');
  return (
    <View style={cs.runsCard}>
      {runs.map((run, idx) => {
        const isLast = idx === runs.length - 1;
        const canOpen = !!run.conversation_id;
        const statusKey = RUN_STATUS_KEY[run.status];
        return (
          <View key={run.id}>
            <View style={cs.runRow}>
              <View
                style={[
                  cs.dot,
                  { backgroundColor: DOT_COLOR[run.status] ?? brandColors.textMuted },
                ]}
              />
              <View style={cs.runInfo}>
                <Text style={cs.runStatus} numberOfLines={1}>
                  {run.run_number != null ? t('workflows.runNumber', { n: run.run_number }) : ''}
                  {statusKey ? t(statusKey) : run.status}
                </Text>
                <Text style={cs.runTime} numberOfLines={1}>
                  {formatNextRunOrExpiry(run.scheduled_for, todayLabel)}
                </Text>
                {run.stop_condition_satisfied === true ? (
                  <Text style={cs.runStopSatisfied} numberOfLines={1}>
                    {t('workflows.stopConditionSatisfied')}
                  </Text>
                ) : null}
                {run.error_message ? (
                  <Text style={cs.runError} numberOfLines={2}>
                    {run.error_message}
                  </Text>
                ) : null}
              </View>
              {canOpen ? (
                <TouchableOpacity
                  onPress={() => onOpenConversation(run)}
                  accessibilityRole="button"
                >
                  <Text style={cs.openLink} numberOfLines={1}>
                    {t('workflows.openConversation')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={cs.noConv} numberOfLines={1}>
                  {t('workflows.noConversation')}
                </Text>
              )}
            </View>
            {!isLast && <View style={cs.divider} />}
          </View>
        );
      })}
    </View>
  );
}

const cs = StyleSheet.create({
  infoCard: {
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
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
  watchActive: { color: brandColors.cyan },
  divider: { height: 1, backgroundColor: brandRgba.silver78 },
  watchActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  watchBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  watchBtnStop: {
    backgroundColor: brandRgba.coralSoft,
    borderWidth: 1,
    borderColor: brandColors.coral,
  },
  watchBtnRestart: {
    backgroundColor: brandRgba.cyanSoft,
    borderWidth: 1,
    borderColor: brandColors.cyan,
  },
  watchBtnText: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '600',
    color: brandColors.ink,
  },
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
  runStopSatisfied: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: brandColors.lime,
    marginTop: 2,
  },
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
});

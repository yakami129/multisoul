import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Workflow, type WorkflowRun } from '../types';

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

const WATCH_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  stopped: 'Stopped',
  expired: 'Expired',
  failed: 'Failed',
};

function formatNextRunOrExpiry(ts: number | null): string {
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
  return formatNextRunOrExpiry(ts);
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
  return (
    <>
      <View style={cs.infoCard}>
        <View style={cs.infoRow}>
          <Text style={cs.infoLabel}>Status</Text>
          <Text style={[cs.infoValue, workflow.watch_status === 'active' && cs.watchActive]}>
            {workflow.watch_status ? WATCH_STATUS_LABEL[workflow.watch_status] : '—'}
          </Text>
        </View>
        <View style={cs.divider} />
        <View style={cs.infoRow}>
          <Text style={cs.infoLabel}>Runs</Text>
          <Text style={cs.infoValue}>
            {workflow.run_count}
            {workflow.max_runs ? ` / ${workflow.max_runs}` : ''}
          </Text>
        </View>
        {workflow.expires_at ? (
          <>
            <View style={cs.divider} />
            <View style={cs.infoRow}>
              <Text style={cs.infoLabel}>Expires</Text>
              <Text style={cs.infoValue}>{formatNextRunOrExpiry(workflow.expires_at)}</Text>
            </View>
          </>
        ) : null}
        {workflow.stop_condition ? (
          <>
            <View style={cs.divider} />
            <View style={[cs.infoRow, { alignItems: 'flex-start' }]}>
              <Text style={cs.infoLabel}>Stop Condition</Text>
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
            <Text style={cs.watchBtnText}>Stop Watch</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[cs.watchBtn, cs.watchBtnRestart]}
            onPress={onRestartWatch}
            disabled={restartWatchPending}
            accessibilityRole="button"
            accessibilityLabel="Restart Watch"
          >
            <Text style={cs.watchBtnText}>Restart Watch</Text>
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
  return (
    <View style={cs.runsCard}>
      {runs.map((run, idx) => {
        const isLast = idx === runs.length - 1;
        const canOpen = !!run.conversation_id;
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
                  {run.run_number != null ? `Run #${run.run_number} · ` : ''}
                  {STATUS_LABEL[run.status] ?? run.status}
                </Text>
                <Text style={cs.runTime} numberOfLines={1}>
                  {formatRunTime(run.scheduled_for)}
                </Text>
                {run.stop_condition_satisfied === true ? (
                  <Text style={cs.runStopSatisfied} numberOfLines={1}>
                    Stop condition satisfied
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
                    Open Conversation
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={cs.noConv} numberOfLines={1}>
                  No conversation
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

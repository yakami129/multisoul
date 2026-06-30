import { ChevronLeft } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conversationDisplaySummary, conversationDisplayTitle } from '@/features/chat';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Project, type ProjectResource, type ProjectSession } from '../types';
import { projectDetailStyles as s } from './ProjectDetail.styles';
import {
  displayRuntime,
  formatProjectPath,
  relativeAge,
  resourceNameForSession,
  totalSessions,
} from './projectUi';

type Segment = 'sessions' | 'resources' | 'settings';
type Tone = 'coral' | 'cyan' | 'lime' | 'sage' | 'default';

interface Props {
  project: Project | undefined;
  sessions: ProjectSession[];
  resources: ProjectResource[];
  isLoading: boolean;
  isError: boolean;
  onBack: () => void;
  onNewSession: () => void;
  onOpenSession: (session: ProjectSession, resource?: ProjectResource) => void;
  onOpenResource: (resource: ProjectResource) => void;
}

function sessionTone(status: string): Tone {
  if (status === 'awaiting_question') return 'coral';
  if (status === 'running') return 'cyan';
  if (status === 'completed') return 'lime';
  return 'sage';
}

function toneColor(tone: Tone): string {
  if (tone === 'coral') return brandColors.coral;
  if (tone === 'cyan') return brandColors.cyan;
  if (tone === 'lime') return brandColors.lime;
  if (tone === 'sage') return brandColors.sage;
  return brandColors.silver;
}

function resourceAvatarInfo(runtime: ProjectResource['runtime']): { abbr: string; tone: Tone } {
  if (runtime === 'codex') return { abbr: 'CX', tone: 'cyan' };
  if (runtime === 'claude-code') return { abbr: 'CC', tone: 'lime' };
  if (runtime === 'cursor-cli') return { abbr: 'CR', tone: 'sage' };
  if (runtime === 'opencode') return { abbr: 'OC', tone: 'cyan' };
  return { abbr: 'CT', tone: 'coral' };
}

const PILL_BG: Record<Tone, string> = {
  coral: brandColors.activityTagOrangeBg,
  cyan: brandColors.activityTagBlueBg,
  lime: brandRgba.limeSoft,
  sage: brandRgba.ink08,
  default: brandRgba.ink08,
};
const PILL_TEXT: Record<Tone, string> = {
  coral: brandColors.activityTagOrangeText,
  cyan: brandColors.activityTagBlueText,
  lime: brandColors.activityTagGreenText,
  sage: brandColors.textSoft,
  default: brandColors.textSoft,
};

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={[s.pill, { backgroundColor: PILL_BG[tone] }]}>
      <View style={[s.pillDot, { backgroundColor: PILL_TEXT[tone] }]} />
      <Text style={[s.pillText, { color: PILL_TEXT[tone] }]}>{label}</Text>
    </View>
  );
}

function SessionCard({
  session,
  index,
  resourceName,
  stateLabel,
  onPress,
}: {
  session: ProjectSession;
  index: number;
  resourceName: string;
  stateLabel: string;
  onPress: () => void;
}) {
  const tone = sessionTone(session.status);
  const summary = conversationDisplaySummary(session);
  return (
    <TouchableOpacity
      accessibilityLabel={`Open ${conversationDisplayTitle(session)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={s.card}
    >
      <View style={s.cardTop}>
        <View style={[s.avatar, { backgroundColor: toneColor(tone) }]}>
          <Text style={s.avatarNumText}>{index + 1}</Text>
        </View>
        <View style={s.cardBody}>
          <Text numberOfLines={1} style={s.cardTitle}>
            {conversationDisplayTitle(session)}
          </Text>
          <Text numberOfLines={1} style={s.cardMeta}>
            {relativeAge(session.last_message_at)}
          </Text>
          {summary ? (
            <Text numberOfLines={2} style={s.cardPreview}>
              {summary}
            </Text>
          ) : null}
          <View style={s.chips}>
            <View style={[s.chip, tone === 'cyan' && s.chipCyan]}>
              <Text style={s.chipText}>{resourceName}</Text>
            </View>
          </View>
        </View>
        <StatusPill label={stateLabel} tone={tone === 'sage' ? 'default' : tone} />
      </View>
    </TouchableOpacity>
  );
}

function ResourceCard({
  resource,
  sessionCount,
  defaultLabel,
  sessionCountLabel,
  availableLabel,
  configLabel,
  onPress,
}: {
  resource: ProjectResource;
  sessionCount: number;
  defaultLabel: string;
  sessionCountLabel: string;
  availableLabel: string;
  configLabel: string;
  onPress: () => void;
}) {
  const { abbr, tone } = resourceAvatarInfo(resource.runtime);
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={[s.avatar, { backgroundColor: toneColor(tone) }]}>
          <Text style={s.avatarAbbrText}>{abbr}</Text>
        </View>
        <View style={s.cardBody}>
          <Text numberOfLines={1} style={s.cardTitle}>
            {resource.name}
          </Text>
          <Text numberOfLines={1} style={s.cardMeta}>
            {displayRuntime(resource.runtime)}
          </Text>
          <View style={s.chips}>
            {resource.is_default && (
              <View style={[s.chip, s.chipCyan]}>
                <Text style={s.chipText}>{defaultLabel}</Text>
              </View>
            )}
            {sessionCount > 0 && (
              <View style={s.chip}>
                <Text style={s.chipText}>{sessionCountLabel}</Text>
              </View>
            )}
            <View style={s.chip}>
              <Text style={s.chipText}>{formatProjectPath(resource.project_path)}</Text>
            </View>
          </View>
        </View>
        <View style={s.resourceRight}>
          <StatusPill label={availableLabel} tone="lime" />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Configure ${resource.name}`}
            onPress={onPress}
            style={s.configBtn}
          >
            <Text style={s.configBtnText}>{configLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export function ProjectDetail({
  project,
  sessions,
  resources,
  isLoading,
  isError,
  onBack,
  onNewSession,
  onOpenSession,
  onOpenResource,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = React.useState<Segment>('sessions');

  const resourceById = React.useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const sessionCountByResource = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const sess of sessions) map.set(sess.agent_id, (map.get(sess.agent_id) ?? 0) + 1);
    return map;
  }, [sessions]);
  const defaultResource =
    resources.find((r) => r.id === project?.default_resource_id) ?? resources[0];

  const navRow = (
    <View style={s.navRow}>
      <TouchableOpacity
        onPress={onBack}
        style={s.circleBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ChevronLeft size={22} color={brandColors.ink} />
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        {navRow}
        <View style={s.centered}>
          <ActivityIndicator size="large" color={brandColors.cyan} />
        </View>
      </View>
    );
  }

  if (isError || !project) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        {navRow}
        <View style={s.centered}>
          <Text style={s.errorTitle}>{t('projects.failedToLoad')}</Text>
          <TouchableOpacity style={s.errorBtn} onPress={onBack}>
            <Text style={s.errorBtnText}>{t('projects.detailBack')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const pendingCount = project.session_counts.awaiting_question;
  const segLabels: Record<Segment, string> = {
    sessions: t('projects.detailSessions'),
    resources: t('projects.detailResources'),
    settings: t('projects.detailSettings'),
  };
  const sessionStatusLabels: Record<string, string> = {
    awaiting_question: t('projects.statsNeedsYou'),
    running: t('projects.statusRunning'),
    completed: t('projects.statusCompleted'),
    failed: t('projects.statusFailed'),
    idle: t('projects.statusIdle'),
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {navRow}
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: (insets.bottom || 16) + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Project hero card */}
        <View style={s.heroCard}>
          <Text style={s.heroEyebrow}>{t('projects.detailHeroLabel')}</Text>
          <Text style={s.heroTitle}>{project.name}</Text>
          <Text numberOfLines={1} style={s.heroMeta}>
            {formatProjectPath(project.project_path)} · {project.endpoint_label}
          </Text>
          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Text style={s.statNum}>{totalSessions(project)}</Text>
              <Text style={s.statLabel}>{t('projects.sessions')}</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <Text style={s.statNum}>{pendingCount}</Text>
              <Text style={s.statLabel}>{t('projects.pending')}</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <Text style={s.statNum}>{project.resource_count}</Text>
              <Text style={s.statLabel}>{t('projects.resources')}</Text>
            </View>
          </View>
        </View>

        {/* Segment tabs */}
        <View style={s.segmented}>
          {(['sessions', 'resources', 'settings'] as Segment[]).map((seg) => (
            <TouchableOpacity
              key={seg}
              accessibilityRole="button"
              accessibilityState={{ selected: segment === seg }}
              onPress={() => setSegment(seg)}
              style={[s.segment, segment === seg && s.segmentActive]}
            >
              <Text style={[s.segmentText, segment === seg && s.segmentTextActive]}>
                {segLabels[seg]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {segment === 'sessions' && (
          <>
            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>{t('projects.detailSessions')}</Text>
              <Text style={s.sectionMeta}>{t('projects.sortByStatus')}</Text>
            </View>
            <View style={s.list}>
              {sessions.length === 0 ? (
                <Text style={s.emptyText}>{t('projects.noSessions')}</Text>
              ) : (
                sessions.map((session, i) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    index={i}
                    resourceName={resourceNameForSession(session, resourceById)}
                    stateLabel={sessionStatusLabels[session.status] ?? t('projects.statusIdle')}
                    onPress={() => onOpenSession(session, resourceById.get(session.agent_id))}
                  />
                ))
              )}
            </View>
            <View style={s.composerHint}>
              <View style={s.composerBody}>
                <Text style={s.composerTitle}>
                  {t('projects.newSessionUsing', { name: defaultResource?.name ?? '...' })}
                </Text>
                <Text style={s.composerSub}>{t('projects.newSessionRuntimeHint')}</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onNewSession}
                style={s.composerBtn}
              >
                <Text style={s.composerBtnText}>{t('projects.newSession')}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {segment === 'resources' && (
          <>
            <View style={s.resourceHeroCard}>
              <Text style={s.resourceEyebrow}>{project.name}</Text>
              <Text style={s.resourceHeroTitle}>{t('projects.runtimeResourcesTitle')}</Text>
              <Text style={s.resourceHeroDesc}>{t('projects.runtimeResourcesDesc')}</Text>
            </View>
            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>{t('projects.availableRuntimes')}</Text>
              {defaultResource && (
                <Text style={s.sectionMeta}>
                  {t('projects.defaultResourceName', { name: defaultResource.name })}
                </Text>
              )}
            </View>
            <View style={s.list}>
              {resources.length === 0 ? (
                <Text style={s.emptyText}>{t('projects.noResources')}</Text>
              ) : (
                resources.map((resource) => (
                  <ResourceCard
                    key={resource.id}
                    resource={resource}
                    sessionCount={sessionCountByResource.get(resource.id) ?? 0}
                    defaultLabel={t('projects.defaultResource')}
                    sessionCountLabel={t('projects.resourceSessionCount', {
                      count: sessionCountByResource.get(resource.id) ?? 0,
                    })}
                    availableLabel={t('projects.resourceAvailable')}
                    configLabel={t('projects.resourceSettings')}
                    onPress={() => onOpenResource(resource)}
                  />
                ))
              )}
            </View>
            <View style={[s.composerHint, s.composerHintInfo]}>
              <View style={s.composerBody}>
                <Text style={s.composerTitle}>{t('projects.runtimesInfoTitle')}</Text>
                <Text style={s.composerSub}>{t('projects.runtimesInfoBody')}</Text>
              </View>
            </View>
          </>
        )}

        {segment === 'settings' && (
          <View style={s.settingsPanel}>
            <Text style={s.settingsLabel}>{t('projects.pathLabel')}</Text>
            <Text selectable style={s.settingsValue}>
              {project.project_path}
            </Text>
            <Text style={s.settingsLabel}>{t('projects.defaultResourceLabel')}</Text>
            <Text style={s.settingsValue}>
              {resources.find((r) => r.id === project.default_resource_id)?.name ??
                project.default_resource_id ??
                t('projects.noDefaultResource')}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

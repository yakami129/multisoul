import { ChevronLeft, ChevronRight, Folder, Plus, Terminal } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conversationDisplaySummary, conversationDisplayTitle } from '@/features/chat';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type Project, type ProjectResource, type ProjectSession } from '../types';
import {
  displayRuntime,
  formatProjectPath,
  relativeAge,
  resourceNameForSession,
} from './projectUi';

type Segment = 'sessions' | 'resources' | 'settings';

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

function Header({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <View style={s.nav}>
      <TouchableOpacity
        accessibilityLabel="Back to Projects"
        accessibilityRole="button"
        onPress={onBack}
        style={s.backLink}
      >
        <ChevronLeft size={20} color={brandColors.ink} />
        <Text style={s.backText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.segmentButton, active && s.segmentButtonActive]}
    >
      <Text style={[s.segmentText, active && s.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SessionRow({
  session,
  resourceName,
  onPress,
}: {
  session: ProjectSession;
  resourceName: string;
  onPress: () => void;
}) {
  const active = session.status === 'running' || session.status === 'awaiting_question';
  return (
    <TouchableOpacity
      accessibilityLabel={`Open ${conversationDisplayTitle(session)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={s.row}
    >
      <View style={[s.statusDot, active && s.statusDotActive]} />
      <View style={s.rowCopy}>
        <Text numberOfLines={1} style={s.rowTitle}>
          {conversationDisplayTitle(session)}
        </Text>
        <Text numberOfLines={1} style={s.rowSubtitle}>
          {conversationDisplaySummary(session)}
        </Text>
        <Text numberOfLines={1} style={s.rowMeta}>
          {resourceName} · {session.status} · {relativeAge(session.last_message_at)}
        </Text>
      </View>
      <ChevronRight size={14} color={brandColors.textSoft} />
    </TouchableOpacity>
  );
}

function ResourceRow({
  resource,
  defaultLabel,
  onPress,
}: {
  resource: ProjectResource;
  defaultLabel: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={`Open resource ${resource.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={s.row}
    >
      <View style={s.resourceIcon}>
        <Terminal size={17} color={brandColors.ink} />
      </View>
      <View style={s.rowCopy}>
        <Text numberOfLines={1} style={s.rowTitle}>
          {resource.name}
        </Text>
        <Text numberOfLines={1} style={s.rowSubtitle}>
          {displayRuntime(resource.runtime)}
          {resource.is_default ? ` · ${defaultLabel}` : ''}
        </Text>
        <Text numberOfLines={1} style={s.rowMeta}>
          {formatProjectPath(resource.project_path)}
        </Text>
      </View>
      <ChevronRight size={14} color={brandColors.textSoft} />
    </TouchableOpacity>
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
  const resourceById = React.useMemo(
    () => new Map(resources.map((resource) => [resource.id, resource])),
    [resources],
  );

  if (isLoading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} label={t('projects.detailBack')} />
        <View style={s.centered}>
          <ActivityIndicator size="large" color={brandColors.cyan} />
          <Text style={s.loadingText}>{t('projects.loadingDetail')}</Text>
        </View>
      </View>
    );
  }

  if (isError || !project) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} label={t('projects.detailBack')} />
        <View style={s.centered}>
          <Text style={s.errorTitle}>{t('projects.failedToLoad')}</Text>
          <TouchableOpacity style={s.backBtn} onPress={onBack}>
            <Text style={s.backBtnText}>{t('projects.detailBack')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header onBack={onBack} label={t('projects.detailBack')} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <Text numberOfLines={2} style={s.projectName}>
            {project.name}
          </Text>
          <View style={s.pathRow}>
            <Folder size={14} color={brandColors.textSoft} />
            <Text numberOfLines={1} selectable style={s.workspacePath}>
              {project.endpoint_label} · {formatProjectPath(project.project_path)}
            </Text>
          </View>
        </View>

        <TouchableOpacity accessibilityRole="button" onPress={onNewSession} style={s.newSessionBtn}>
          <Plus size={16} color={brandColors.white} />
          <Text style={s.newSessionText}>{t('projects.newSession')}</Text>
        </TouchableOpacity>

        <View style={s.segmentControl}>
          <SegmentButton
            active={segment === 'sessions'}
            label={t('projects.detailSessions')}
            onPress={() => setSegment('sessions')}
          />
          <SegmentButton
            active={segment === 'resources'}
            label={t('projects.detailResources')}
            onPress={() => setSegment('resources')}
          />
          <SegmentButton
            active={segment === 'settings'}
            label={t('projects.detailSettings')}
            onPress={() => setSegment('settings')}
          />
        </View>

        {segment === 'sessions' ? (
          <View style={s.group}>
            {sessions.length === 0 ? (
              <Text style={s.emptyText}>{t('projects.noSessions')}</Text>
            ) : (
              sessions.map((session) => {
                const resource = resourceById.get(session.agent_id);
                return (
                  <SessionRow
                    key={session.id}
                    session={session}
                    resourceName={resourceNameForSession(session, resourceById)}
                    onPress={() => onOpenSession(session, resource)}
                  />
                );
              })
            )}
          </View>
        ) : null}

        {segment === 'resources' ? (
          <View style={s.group}>
            {resources.length === 0 ? (
              <Text style={s.emptyText}>{t('projects.noResources')}</Text>
            ) : (
              resources.map((resource) => (
                <ResourceRow
                  key={resource.id}
                  resource={resource}
                  defaultLabel={t('projects.defaultResource')}
                  onPress={() => onOpenResource(resource)}
                />
              ))
            )}
          </View>
        ) : null}

        {segment === 'settings' ? (
          <View style={s.settingsPanel}>
            <Text style={s.settingsLabel}>Path</Text>
            <Text selectable style={s.settingsValue}>
              {project.project_path}
            </Text>
            <Text style={s.settingsLabel}>Default resource</Text>
            <Text style={s.settingsValue}>
              {resources.find((resource) => resource.id === project.default_resource_id)?.name ??
                project.default_resource_id ??
                'None'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: brandColors.cream },
  nav: {
    height: 44,
    backgroundColor: brandColors.cream,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: {
    fontFamily: brandTypography.body,
    fontSize: 15,
    fontWeight: '700',
    color: brandColors.ink,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: brandTypography.body, fontSize: 13, color: brandColors.textSoft },
  errorTitle: {
    fontFamily: brandTypography.display,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
    color: brandColors.error,
  },
  backBtn: {
    borderWidth: 1,
    borderColor: brandColors.coral,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 10,
  },
  backBtnText: {
    fontFamily: brandTypography.body,
    fontSize: 14,
    fontWeight: '600',
    color: brandColors.coral,
  },
  scroll: { paddingBottom: 110 },
  hero: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 8 },
  projectName: {
    fontFamily: brandTypography.display,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: brandColors.ink,
  },
  pathRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  workspacePath: {
    flex: 1,
    minWidth: 0,
    fontFamily: brandTypography.body,
    fontSize: 13,
    lineHeight: 18,
    color: brandColors.textSoft,
  },
  newSessionBtn: {
    marginHorizontal: 16,
    height: 44,
    backgroundColor: brandColors.ink,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  newSessionText: {
    fontFamily: brandTypography.body,
    fontSize: 14,
    fontWeight: '700',
    color: brandColors.white,
  },
  segmentControl: {
    marginHorizontal: 16,
    marginTop: 16,
    height: 40,
    borderRadius: 20,
    padding: 3,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    flexDirection: 'row',
  },
  segmentButton: { flex: 1, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  segmentButtonActive: { backgroundColor: brandColors.ink },
  segmentText: {
    fontFamily: brandTypography.body,
    fontSize: 12,
    fontWeight: '800',
    color: brandColors.textSoft,
  },
  segmentTextActive: { color: brandColors.white },
  group: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    overflow: 'hidden',
  },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: brandRgba.silver78,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: brandColors.textMuted },
  statusDotActive: { backgroundColor: brandColors.coral },
  resourceIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: brandRgba.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: {
    fontFamily: brandTypography.body,
    fontSize: 15,
    fontWeight: '800',
    color: brandColors.ink,
  },
  rowSubtitle: { fontFamily: brandTypography.body, fontSize: 12, color: brandColors.textSoft },
  rowMeta: { fontFamily: brandTypography.body, fontSize: 11, color: brandColors.textMuted },
  emptyText: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    color: brandColors.textSoft,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  settingsPanel: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    padding: 14,
    gap: 6,
  },
  settingsLabel: {
    marginTop: 6,
    fontFamily: brandTypography.body,
    fontSize: 11,
    fontWeight: '800',
    color: brandColors.textMuted,
  },
  settingsValue: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    lineHeight: 18,
    color: brandColors.ink,
  },
});

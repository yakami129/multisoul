import { Folder, FolderGit2, MoreHorizontal } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type Project } from '../types';
import { formatProjectPath, projectStatus, relativeAge, totalSessions } from './projectUi';

interface Props {
  project: Project;
  index?: number;
  statusLabel: string;
  onPress: () => void;
}

const avatarColors = [brandColors.cyan, brandColors.lime, brandColors.sage, brandColors.coral];

function statusTone(kind: ReturnType<typeof projectStatus>['kind']) {
  if (kind === 'awaiting_question') {
    return { dot: brandColors.coral, bg: brandRgba.coralSoft, text: brandColors.coral };
  }
  if (kind === 'running') {
    return { dot: brandColors.cyan, bg: brandRgba.cyanSoft, text: brandColors.cyan };
  }
  if (kind === 'failed') {
    return { dot: brandColors.error, bg: brandRgba.coralSoft, text: brandColors.error };
  }
  if (kind === 'completed') {
    return { dot: brandColors.lime, bg: brandRgba.limeSoft, text: brandColors.ink };
  }
  return { dot: brandColors.textMuted, bg: brandRgba.ink08, text: brandColors.textSoft };
}

export function ProjectCard({ project, index = 0, statusLabel, onPress }: Props) {
  const status = projectStatus(project);
  const tone = statusTone(status.kind);
  const sessions = totalSessions(project);
  const avatarColor = avatarColors[index % avatarColors.length];
  const displayedStatus =
    status.pendingCount > 1 ? `${statusLabel} ${status.pendingCount}` : statusLabel;

  return (
    <Pressable
      accessibilityLabel={`Open project ${project.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={s.row}
      testID="project-row"
    >
      <View style={s.avatarFrame}>
        <View style={[s.avatar, { backgroundColor: avatarColor }]}>
          <FolderGit2 size={21} color={brandColors.ink} strokeWidth={2.4} />
        </View>
      </View>
      <View style={s.body}>
        <View style={s.titleRow}>
          <Text numberOfLines={1} style={s.projectName}>
            {project.name}
          </Text>
        </View>
        <Text numberOfLines={1} style={s.metaText}>
          {project.endpoint_label} · {relativeAge(project.last_activity_at)}
        </Text>
        <View style={s.pathRow}>
          <Folder size={14} color={brandColors.textMuted} />
          <Text numberOfLines={1} style={s.pathText}>
            {formatProjectPath(project.project_path)}
          </Text>
        </View>
        <Text numberOfLines={1} style={s.countText}>
          {sessions} sessions · {project.resource_count} resources
        </Text>
      </View>
      <View style={s.trailing}>
        <View style={[s.statusPill, { backgroundColor: tone.bg }]}>
          <View style={[s.statusDot, { backgroundColor: tone.dot }]} />
          <Text numberOfLines={1} style={[s.statusText, { color: tone.text }]}>
            {displayedStatus}
          </Text>
        </View>
        <View style={s.moreButton}>
          <MoreHorizontal size={16} color={brandColors.ink} />
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    width: '100%',
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    shadowColor: brandColors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  avatarFrame: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: brandRgba.white70,
    borderWidth: 1,
    borderColor: brandColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    flexShrink: 0,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  projectName: {
    flex: 1,
    minWidth: 0,
    fontFamily: brandTypography.body,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    color: brandColors.ink,
  },
  metaText: {
    marginTop: 2,
    fontFamily: brandTypography.body,
    fontSize: 12,
    lineHeight: 16,
    color: brandColors.textSoft,
  },
  pathRow: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  pathText: {
    flex: 1,
    minWidth: 0,
    fontFamily: brandTypography.body,
    fontSize: 12,
    lineHeight: 16,
    color: brandColors.textMuted,
  },
  countText: {
    marginTop: 2,
    fontFamily: brandTypography.body,
    fontSize: 11,
    lineHeight: 14,
    color: brandColors.textMuted,
  },
  trailing: { alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginLeft: 8 },
  statusPill: {
    minHeight: 25,
    maxWidth: 104,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 5,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  statusText: {
    flexShrink: 1,
    fontFamily: brandTypography.body,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  moreButton: {
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: brandRgba.ink08,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

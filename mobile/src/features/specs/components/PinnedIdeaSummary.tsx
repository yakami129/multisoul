import { Archive, CheckCircle2, CircleAlert, FileText, MessageSquare } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type SpecIdea } from '../types';
import { deriveIdeaTitle, ideaStatusLabel, relativeAge } from './specUiModels';

interface Props {
  idea: SpecIdea;
}

function StatusIcon({ status }: { status: SpecIdea['status'] }) {
  const color = status === 'failed' ? brandColors.error : brandColors.coral;
  if (status === 'converted') return <CheckCircle2 size={16} color={brandColors.successCompat} />;
  if (status === 'archived') return <Archive size={16} color={brandColors.textSoft} />;
  if (status === 'interviewing') return <MessageSquare size={16} color={brandColors.coral} />;
  if (status === 'failed') return <CircleAlert size={16} color={color} />;
  return <FileText size={16} color={brandColors.coral} />;
}

export function PinnedIdeaSummary({ idea }: Props) {
  const title = deriveIdeaTitle(idea.title, idea.body);
  const target = idea.targetRepoPath || 'No target repo';
  const agent = idea.targetAgentName || 'No agent selected';

  return (
    <View style={s.card}>
      <View style={s.topRow}>
        <View style={s.iconWrap}>
          <StatusIcon status={idea.status} />
        </View>
        <View style={s.titleGroup}>
          <Text style={s.kicker}>PINNED IDEA</Text>
          <Text style={s.title} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <View style={s.statusPill}>
          <Text style={s.statusText}>{ideaStatusLabel(idea.status)}</Text>
        </View>
      </View>
      <Text style={s.body} numberOfLines={4}>
        {idea.body.trim() || 'No notes yet.'}
      </Text>
      <View style={s.metaRow}>
        <Text style={s.meta} numberOfLines={1}>
          {target}
        </Text>
        <Text style={s.dot}>·</Text>
        <Text style={s.meta} numberOfLines={1}>
          {agent}
        </Text>
        <Text style={s.dot}>·</Text>
        <Text style={s.meta}>{relativeAge(idea.updatedAt)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white88,
    padding: 14,
    gap: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandRgba.coralSoft,
  },
  titleGroup: { flex: 1, minWidth: 0 },
  kicker: {
    fontFamily: brandTypography.body,
    fontSize: 10,
    fontWeight: '800',
    color: brandColors.coral,
  },
  title: {
    marginTop: 2,
    fontFamily: brandTypography.display,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: brandColors.ink,
  },
  statusPill: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandRgba.ink08,
  },
  statusText: {
    fontFamily: brandTypography.body,
    fontSize: 10,
    fontWeight: '800',
    color: brandColors.ink,
  },
  body: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    lineHeight: 19,
    color: brandColors.ink,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: {
    flexShrink: 1,
    fontFamily: brandTypography.body,
    fontSize: 11,
    color: brandColors.textSoft,
  },
  dot: { fontFamily: brandTypography.body, fontSize: 11, color: brandColors.textMuted },
});

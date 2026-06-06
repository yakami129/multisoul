import {
  ChevronLeft,
  ExternalLink,
  FileText,
  GitBranch,
  Hash,
  MessageSquare,
  Play,
} from 'lucide-react-native';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type SpecArtifact, type SpecArtifactDetail, type SpecDraft } from '../types';
import { SpecMarkdownReader } from './SpecMarkdownReader';
import { relativeAge, shortHash, specActionLabel, specStatusLabel } from './specUiModels';

interface Props {
  detail: SpecArtifactDetail | undefined;
  fallbackSpec?: SpecArtifact;
  legacySpec?: SpecDraft;
  sourceIdeaTitle?: string;
  isLoading?: boolean;
  isStartingImplementation?: boolean;
  showFullMarkdown?: boolean;
  errorMessage?: string;
  onBack: () => void;
  onStartImplementation?: () => void;
  onOpenInterviewChat?: () => void;
  onOpenImplementationChat?: () => void;
  onOpenSourceIdea?: () => void;
  onReadFull?: () => void;
}

export function SpecDetailScreen({
  detail,
  fallbackSpec,
  legacySpec,
  sourceIdeaTitle,
  isLoading = false,
  isStartingImplementation = false,
  showFullMarkdown = false,
  errorMessage,
  onBack,
  onStartImplementation,
  onOpenInterviewChat,
  onOpenImplementationChat,
  onOpenSourceIdea,
  onReadFull,
}: Props) {
  const insets = useSafeAreaInsets();
  const spec = detail?.spec ?? fallbackSpec;
  const latest = detail?.latestVersion;

  if (!spec && !legacySpec) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} />
        <View style={s.centered}>
          <Text style={s.emptyTitle}>{isLoading ? 'Loading spec...' : 'Spec not found'}</Text>
        </View>
      </View>
    );
  }

  if (!spec && legacySpec) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} />
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.hero}>
            <View style={s.heroIcon}>
              <FileText size={18} color={brandColors.coral} />
            </View>
            <View style={s.heroBody}>
              <Text style={s.title}>{legacySpec.title}</Text>
              <Text style={s.subtitle}>{legacySpec.repoSpecPath || legacySpec.targetRepoPath}</Text>
            </View>
          </View>
          <Section title="Legacy Draft">
            <Text style={s.bodyText}>
              This local draft predates artifact snapshots. Interview it as an Idea or save a repo
              spec to create the current detail view.
            </Text>
            <SpecMarkdownReader markdown={legacySpec.markdownPreview} collapsed />
          </Section>
        </ScrollView>
      </View>
    );
  }

  const currentSpec = spec as SpecArtifact;
  const revision = latest?.revision ?? 1;
  const hash = latest?.markdownSha256;
  const implementationChatId = currentSpec.latestImplementationConversationId;
  const primaryLabel = implementationChatId
    ? 'Open Implementation'
    : isStartingImplementation
      ? 'Starting...'
      : specActionLabel(currentSpec.status);
  const primaryDisabled =
    isStartingImplementation ||
    (!implementationChatId &&
      ['blocked', 'done', 'failed'].includes(currentSpec.status));

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header onBack={onBack} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 96 }]}>
        <View style={s.hero}>
          <View style={s.heroIcon}>
            <FileText size={18} color={brandColors.coral} />
          </View>
          <View style={s.heroBody}>
            <Text style={s.title} numberOfLines={2}>
              {currentSpec.title}
            </Text>
            <Text style={s.subtitle} numberOfLines={1}>
              {currentSpec.repoSpecPath || currentSpec.targetRepoPath}
            </Text>
          </View>
          <View style={s.statusPill}>
            <Text style={s.statusText}>{specStatusLabel(currentSpec.status)}</Text>
          </View>
        </View>

        <View style={s.metricGrid}>
          <Metric icon={<GitBranch size={15} color={brandColors.ink} />} label="Revision" value={`v${revision}`} />
          <Metric icon={<Hash size={15} color={brandColors.ink} />} label="Hash" value={shortHash(hash)} />
        </View>

        <Section title="Repository">
          <InfoRow label="Repo" value={currentSpec.targetRepoPath || 'Unknown repo'} />
          <InfoRow label="Spec file" value={currentSpec.repoSpecPath || latest?.repoSpecPath || 'Not saved'} />
          <InfoRow label="Updated" value={relativeAge(currentSpec.updatedAt)} />
        </Section>

        <Section title="Artifact Snapshot">
          <SpecMarkdownReader markdown={latest?.markdown} collapsed={!showFullMarkdown} />
          <TouchableOpacity accessibilityRole="button" onPress={onReadFull} style={s.inlineButton}>
            <ExternalLink size={15} color={brandColors.ink} />
            <Text style={s.inlineButtonText}>
              {showFullMarkdown ? 'Collapse snapshot' : 'Read full snapshot'}
            </Text>
          </TouchableOpacity>
        </Section>

        <Section title="Source">
          <ActionRow
            icon={<FileText size={16} color={brandColors.ink} />}
            label="Idea"
            value={sourceIdeaTitle || currentSpec.sourceIdeaId || 'Not linked'}
            disabled={!currentSpec.sourceIdeaId}
            onPress={onOpenSourceIdea}
          />
          <ActionRow
            icon={<MessageSquare size={16} color={brandColors.ink} />}
            label="Interview chat"
            value={currentSpec.interviewConversationId || 'Not linked'}
            disabled={!currentSpec.interviewConversationId}
            onPress={onOpenInterviewChat}
          />
          <ActionRow
            icon={<MessageSquare size={16} color={brandColors.ink} />}
            label="Latest implementation"
            value={implementationChatId || 'Not started'}
            disabled={!implementationChatId}
            onPress={onOpenImplementationChat}
          />
        </Section>

        {errorMessage ? <Text style={s.errorText}>{errorMessage}</Text> : null}
      </ScrollView>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: primaryDisabled }}
          disabled={primaryDisabled}
          onPress={implementationChatId ? onOpenImplementationChat : onStartImplementation}
          style={[s.primaryButton, primaryDisabled && s.disabled]}
        >
          <Play size={17} color={brandColors.white} />
          <Text style={s.primaryText}>{primaryLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" onPress={onBack} style={s.backButton}>
        <ChevronLeft size={20} color={brandColors.ink} />
        <Text style={s.backText}>Specs</Text>
      </TouchableOpacity>
      <Text style={s.headerTitle}>Spec</Text>
      <View style={s.headerSpacer} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={s.metric}>
      {icon}
      <View>
        <Text style={s.metricLabel}>{label}</Text>
        <Text style={s.metricValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  value,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  disabled: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.actionRow, disabled && s.disabled]}
    >
      <View style={s.actionIcon}>{icon}</View>
      <View style={s.actionBody}>
        <Text style={s.actionLabel}>{label}</Text>
        <Text style={s.actionValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: brandColors.cream },
  header: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  backButton: { minWidth: 72, minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  backText: { fontFamily: brandTypography.body, fontSize: 13, fontWeight: '700', color: brandColors.ink },
  headerTitle: {
    fontFamily: brandTypography.display,
    fontSize: 18,
    fontWeight: '700',
    color: brandColors.ink,
  },
  headerSpacer: { width: 72 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: brandTypography.display, fontSize: 20, fontWeight: '700', color: brandColors.ink },
  content: { padding: 16, gap: 12 },
  hero: {
    minHeight: 72,
    borderRadius: 16,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: brandRgba.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: brandTypography.display,
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '700',
    color: brandColors.ink,
  },
  subtitle: { marginTop: 3, fontFamily: brandTypography.body, fontSize: 11, color: brandColors.textSoft },
  statusPill: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandRgba.limeSoft,
  },
  statusText: { fontFamily: brandTypography.body, fontSize: 10, fontWeight: '800', color: brandColors.ink },
  metricGrid: { flexDirection: 'row', gap: 10 },
  metric: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
  },
  metricLabel: { fontFamily: brandTypography.body, fontSize: 10, color: brandColors.textSoft },
  metricValue: { marginTop: 2, fontFamily: brandTypography.body, fontSize: 13, fontWeight: '800', color: brandColors.ink },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white88,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { fontFamily: brandTypography.body, fontSize: 11, fontWeight: '800', color: brandColors.coral },
  bodyText: { fontFamily: brandTypography.body, fontSize: 13, lineHeight: 19, color: brandColors.ink },
  infoRow: { minHeight: 34, flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  infoLabel: { fontFamily: brandTypography.body, fontSize: 12, color: brandColors.textSoft },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: brandTypography.body,
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.ink,
  },
  inlineButton: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: brandRgba.ink08,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  inlineButtonText: { fontFamily: brandTypography.body, fontSize: 13, fontWeight: '800', color: brandColors.ink },
  actionRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: brandRgba.ink08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBody: { flex: 1, minWidth: 0 },
  actionLabel: { fontFamily: brandTypography.body, fontSize: 13, fontWeight: '800', color: brandColors.ink },
  actionValue: { marginTop: 2, fontFamily: brandTypography.body, fontSize: 11, color: brandColors.textSoft },
  errorText: { fontFamily: brandTypography.body, fontSize: 12, lineHeight: 17, color: brandColors.error },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: brandRgba.white88,
    borderTopWidth: 1,
    borderTopColor: brandColors.silver,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: brandColors.ink,
  },
  primaryText: { fontFamily: brandTypography.body, fontSize: 13, fontWeight: '800', color: brandColors.white },
  disabled: { opacity: 0.45 },
});

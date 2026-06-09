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
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors } from '@/theme/brandRefresh';
import { type SpecArtifact, type SpecArtifactDetail, type SpecDraft } from '../types';
import { specDetailScreenStyles as s } from './specDetailScreenStyles';
import { SpecMarkdownReader } from './SpecMarkdownReader';
import { type SpecAssetStatus, relativeAge, shortHash } from './specUiModels';

const SPEC_STATUS_KEY: Record<
  SpecAssetStatus,
  | 'specs.specStatusDraft'
  | 'specs.specStatusReady'
  | 'specs.specStatusPlanning'
  | 'specs.specStatusRunning'
  | 'specs.specStatusNeedsYou'
  | 'specs.specStatusDone'
  | 'specs.statusFailed'
> = {
  draft: 'specs.specStatusDraft',
  ready: 'specs.specStatusReady',
  planning: 'specs.specStatusPlanning',
  implementing: 'specs.specStatusRunning',
  blocked: 'specs.specStatusNeedsYou',
  done: 'specs.specStatusDone',
  failed: 'specs.statusFailed',
};

const SPEC_ACTION_KEY: Record<
  SpecAssetStatus,
  | 'specs.actionAnswerRequired'
  | 'specs.actionOpenChat'
  | 'specs.actionOpenSummary'
  | 'specs.actionReviewSpec'
  | 'specs.actionReviewFailure'
  | 'specs.actionStartImpl'
> = {
  blocked: 'specs.actionAnswerRequired',
  planning: 'specs.actionOpenChat',
  implementing: 'specs.actionOpenChat',
  done: 'specs.actionOpenSummary',
  draft: 'specs.actionReviewSpec',
  failed: 'specs.actionReviewFailure',
  ready: 'specs.actionStartImpl',
};

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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const spec = detail?.spec ?? fallbackSpec;
  const latest = detail?.latestVersion;
  const backLabel = t('specs.backToSpecs');
  const headerTitle = t('specs.headerSpec');

  if (!spec && !legacySpec) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} backLabel={backLabel} headerTitle={headerTitle} />
        <View style={s.centered}>
          <Text style={s.emptyTitle}>
            {isLoading ? t('specs.loadingSpec') : t('specs.specNotFound')}
          </Text>
        </View>
      </View>
    );
  }

  if (!spec && legacySpec) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} backLabel={backLabel} headerTitle={headerTitle} />
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
          <Section title={t('specs.legacyDraft')}>
            <Text style={s.bodyText}>{t('specs.legacyDraftDesc')}</Text>
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
    ? t('specs.openImplementation')
    : isStartingImplementation
      ? t('specs.startingEllipsis')
      : t(SPEC_ACTION_KEY[currentSpec.status]);
  const primaryDisabled =
    isStartingImplementation ||
    (!implementationChatId && ['blocked', 'done', 'failed'].includes(currentSpec.status));

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header onBack={onBack} backLabel={backLabel} headerTitle={headerTitle} />
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
            <Text style={s.statusText}>{t(SPEC_STATUS_KEY[currentSpec.status])}</Text>
          </View>
        </View>

        <View style={s.metricGrid}>
          <Metric
            icon={<GitBranch size={15} color={brandColors.ink} />}
            label={t('specs.labelRevision')}
            value={`v${revision}`}
          />
          <Metric
            icon={<Hash size={15} color={brandColors.ink} />}
            label={t('specs.labelHash')}
            value={shortHash(hash)}
          />
        </View>

        <Section title={t('specs.sectionRepository')}>
          <InfoRow
            label={t('specs.labelRepo')}
            value={currentSpec.targetRepoPath || t('specs.unknownRepo')}
          />
          <InfoRow
            label={t('specs.labelSpecFile')}
            value={currentSpec.repoSpecPath || latest?.repoSpecPath || t('specs.notSaved')}
          />
          <InfoRow label={t('specs.labelUpdated')} value={relativeAge(currentSpec.updatedAt)} />
        </Section>

        <Section title={t('specs.sectionArtifact')}>
          <SpecMarkdownReader markdown={latest?.markdown} collapsed={!showFullMarkdown} />
          <TouchableOpacity accessibilityRole="button" onPress={onReadFull} style={s.inlineButton}>
            <ExternalLink size={15} color={brandColors.ink} />
            <Text style={s.inlineButtonText}>
              {showFullMarkdown ? t('specs.collapseSnapshot') : t('specs.readFullSnapshot')}
            </Text>
          </TouchableOpacity>
        </Section>

        <Section title={t('specs.sectionSource')}>
          <ActionRow
            icon={<FileText size={16} color={brandColors.ink} />}
            label={t('specs.labelIdea')}
            value={sourceIdeaTitle || currentSpec.sourceIdeaId || t('specs.notLinked')}
            disabled={!currentSpec.sourceIdeaId}
            onPress={onOpenSourceIdea}
          />
          <ActionRow
            icon={<MessageSquare size={16} color={brandColors.ink} />}
            label={t('specs.interviewChat')}
            value={currentSpec.interviewConversationId || t('specs.notLinked')}
            disabled={!currentSpec.interviewConversationId}
            onPress={onOpenInterviewChat}
          />
          <ActionRow
            icon={<MessageSquare size={16} color={brandColors.ink} />}
            label={t('specs.labelLatestImpl')}
            value={implementationChatId || t('specs.notStarted')}
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

function Header({
  onBack,
  backLabel,
  headerTitle,
}: {
  onBack: () => void;
  backLabel: string;
  headerTitle: string;
}) {
  return (
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" onPress={onBack} style={s.backButton}>
        <ChevronLeft size={20} color={brandColors.ink} />
        <Text style={s.backText}>{backLabel}</Text>
      </TouchableOpacity>
      <Text style={s.headerTitle}>{headerTitle}</Text>
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

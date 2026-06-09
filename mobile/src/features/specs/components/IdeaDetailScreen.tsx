import {
  Archive,
  Camera,
  ChevronLeft,
  FileText,
  Link,
  MessageSquare,
  Pencil,
  Play,
  RotateCcw,
} from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type SpecIdea, type SpecIdeaAttachment } from '../types';
import { PinnedIdeaSummary } from './PinnedIdeaSummary';
import { relativeAge } from './specUiModels';

interface Props {
  idea: SpecIdea | undefined;
  isStartingInterview?: boolean;
  errorMessage?: string;
  onBack: () => void;
  onEdit?: () => void;
  onStartInterview?: () => void;
  onOpenInterviewChat?: () => void;
  onOpenConvertedSpec?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
}

function attachmentIcon(kind: SpecIdeaAttachment['kind']) {
  if (kind === 'link') return <Link size={15} color={brandColors.coral} />;
  if (kind === 'image') return <Camera size={15} color={brandColors.coral} />;
  return <FileText size={15} color={brandColors.coral} />;
}

function attachmentTitle(attachment: SpecIdeaAttachment, logSnippet: string): string {
  if (attachment.title?.trim()) return attachment.title;
  if (attachment.uri?.trim()) return attachment.uri;
  if (attachment.text?.trim()) return attachment.text.split('\n')[0]?.slice(0, 80) || logSnippet;
  return `${attachment.kind} attachment`;
}

export function IdeaDetailScreen({
  idea,
  isStartingInterview = false,
  errorMessage,
  onBack,
  onEdit,
  onStartInterview,
  onOpenInterviewChat,
  onOpenConvertedSpec,
  onArchive,
  onUnarchive,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  if (!idea) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Header
          onBack={onBack}
          onEdit={undefined}
          backLabel={t('specs.backToIdeas')}
          headerTitle={t('specs.headerIdea')}
        />
        <View style={s.centered}>
          <Text style={s.emptyTitle}>{t('specs.ideaNotFound')}</Text>
        </View>
      </View>
    );
  }

  const hasTarget = Boolean(idea.targetRepoPath && idea.targetAgentId && idea.targetEndpointId);
  const canStart = hasTarget && !isStartingInterview && idea.status !== 'converted';
  const primaryLabel = idea.interviewConversationId
    ? t('specs.continueInterview')
    : isStartingInterview
      ? t('specs.startingEllipsis')
      : t('specs.startInterview');
  const logSnippet = t('specs.logSnippet');

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Header
        onBack={onBack}
        onEdit={onEdit}
        backLabel={t('specs.backToIdeas')}
        headerTitle={t('specs.headerIdea')}
      />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 96 }]}>
        <PinnedIdeaSummary idea={idea} />

        <Section title={t('specs.sectionNotes')}>
          <Text style={s.bodyText}>{idea.body.trim() || t('specs.noPrimaryNote')}</Text>
          {idea.notes.length > 0 ? (
            <View style={s.noteList}>
              {idea.notes.map((note) => (
                <View key={note.id} style={s.note}>
                  <Text style={s.noteMeta}>{relativeAge(note.updatedAt || note.createdAt)}</Text>
                  <Text style={s.noteBody}>{note.body}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.mutedText}>{t('specs.notesGrow')}</Text>
          )}
        </Section>

        <Section title={t('specs.sectionAttachments')}>
          {idea.attachments.length > 0 ? (
            <View style={s.attachmentList}>
              {idea.attachments.map((attachment) => (
                <View key={attachment.id} style={s.attachment}>
                  <View style={s.attachmentIcon}>{attachmentIcon(attachment.kind)}</View>
                  <View style={s.attachmentBody}>
                    <Text style={s.attachmentTitle} numberOfLines={1}>
                      {attachmentTitle(attachment, logSnippet)}
                    </Text>
                    <Text style={s.attachmentMeta} numberOfLines={2}>
                      {attachment.uri ||
                        attachment.fileId ||
                        attachment.text ||
                        t('specs.savedWithIdea')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.mutedText}>{t('specs.attachmentsEmpty')}</Text>
          )}
        </Section>

        <Section title={t('specs.sectionTarget')}>
          <InfoRow
            label={t('specs.labelRepo')}
            value={idea.targetRepoPath || t('specs.notSelected')}
          />
          <InfoRow
            label={t('specs.labelAgent')}
            value={idea.targetAgentName || idea.targetAgentId || t('specs.notSelected')}
          />
          <InfoRow
            label={t('specs.labelEndpoint')}
            value={idea.targetEndpointId || t('specs.notSelected')}
          />
          {!hasTarget ? <Text style={s.errorText}>{t('specs.chooseRepoFirst')}</Text> : null}
        </Section>

        <Section title={t('specs.sectionRelated')}>
          <ActionRow
            icon={<MessageSquare size={16} color={brandColors.ink} />}
            label={t('specs.interviewChat')}
            value={idea.interviewConversationId || t('specs.notStarted')}
            disabled={!idea.interviewConversationId}
            onPress={onOpenInterviewChat}
          />
          <ActionRow
            icon={<FileText size={16} color={brandColors.ink} />}
            label={t('specs.convertedSpec')}
            value={idea.convertedSpecId || t('specs.notSaved')}
            disabled={!idea.convertedSpecId}
            onPress={onOpenConvertedSpec}
          />
        </Section>

        {idea.errorMessage ? <Text style={s.errorText}>{idea.errorMessage}</Text> : null}
        {errorMessage ? <Text style={s.errorText}>{errorMessage}</Text> : null}
      </ScrollView>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={idea.status === 'archived' ? onUnarchive : onArchive}
          style={s.secondaryButton}
        >
          {idea.status === 'archived' ? (
            <RotateCcw size={17} color={brandColors.ink} />
          ) : (
            <Archive size={17} color={brandColors.ink} />
          )}
          <Text style={s.secondaryText}>
            {idea.status === 'archived' ? t('specs.ideaUnarchive') : t('specs.ideaArchive')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: !canStart && !idea.interviewConversationId }}
          disabled={!canStart && !idea.interviewConversationId}
          onPress={idea.interviewConversationId ? onOpenInterviewChat : onStartInterview}
          style={[s.primaryButton, !canStart && !idea.interviewConversationId && s.disabled]}
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
  onEdit,
  backLabel,
  headerTitle,
}: {
  onBack: () => void;
  onEdit?: () => void;
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
      {onEdit ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Edit idea"
          onPress={onEdit}
          style={s.editButton}
        >
          <Pencil size={18} color={brandColors.ink} />
        </TouchableOpacity>
      ) : (
        <View style={s.headerSpacer} />
      )}
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
  backText: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    fontWeight: '700',
    color: brandColors.ink,
  },
  headerTitle: {
    fontFamily: brandTypography.display,
    fontSize: 18,
    fontWeight: '700',
    color: brandColors.ink,
  },
  headerSpacer: { width: 72 },
  editButton: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: {
    fontFamily: brandTypography.display,
    fontSize: 20,
    fontWeight: '700',
    color: brandColors.ink,
  },
  content: { padding: 16, gap: 12 },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: brandColors.silver,
    backgroundColor: brandRgba.white88,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontFamily: brandTypography.body,
    fontSize: 11,
    fontWeight: '800',
    color: brandColors.coral,
  },
  bodyText: {
    fontFamily: brandTypography.body,
    fontSize: 14,
    lineHeight: 20,
    color: brandColors.ink,
  },
  mutedText: {
    fontFamily: brandTypography.body,
    fontSize: 12,
    lineHeight: 18,
    color: brandColors.textSoft,
  },
  noteList: { gap: 8 },
  note: { borderRadius: 12, backgroundColor: brandRgba.ink08, padding: 10, gap: 5 },
  noteMeta: { fontFamily: brandTypography.body, fontSize: 10, color: brandColors.textSoft },
  noteBody: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    lineHeight: 18,
    color: brandColors.ink,
  },
  attachmentList: { gap: 8 },
  attachment: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 },
  attachmentIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: brandRgba.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentBody: { flex: 1, minWidth: 0 },
  attachmentTitle: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    fontWeight: '800',
    color: brandColors.ink,
  },
  attachmentMeta: {
    marginTop: 2,
    fontFamily: brandTypography.body,
    fontSize: 11,
    color: brandColors.textSoft,
  },
  infoRow: {
    minHeight: 34,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  infoLabel: { fontFamily: brandTypography.body, fontSize: 12, color: brandColors.textSoft },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: brandTypography.body,
    fontSize: 12,
    fontWeight: '700',
    color: brandColors.ink,
  },
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
  actionLabel: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    fontWeight: '800',
    color: brandColors.ink,
  },
  actionValue: {
    marginTop: 2,
    fontFamily: brandTypography.body,
    fontSize: 11,
    color: brandColors.textSoft,
  },
  errorText: {
    fontFamily: brandTypography.body,
    fontSize: 12,
    lineHeight: 17,
    color: brandColors.error,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: brandRgba.white88,
    borderTopWidth: 1,
    borderTopColor: brandColors.silver,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: brandRgba.ink08,
  },
  secondaryText: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    fontWeight: '800',
    color: brandColors.ink,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: brandColors.ink,
  },
  primaryText: {
    fontFamily: brandTypography.body,
    fontSize: 13,
    fontWeight: '800',
    color: brandColors.white,
  },
  disabled: { opacity: 0.45 },
});

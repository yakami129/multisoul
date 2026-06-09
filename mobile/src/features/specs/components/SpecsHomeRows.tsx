import {
  Archive,
  CheckCircle2,
  ChevronRight,
  FileText,
  Image,
  Lightbulb,
  List,
  Trash2,
} from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { brandColors } from '@/theme/brandRefresh';
import { specsHomeStyles as s } from './SpecsHomeStyles';
import {
  deriveIdeaTitle,
  type IdeaStatus,
  type SpecAssetStatus,
  relativeAge,
  shortHash,
  type SpecArtifact,
  type SpecIdea,
} from './specUiModels';

export type AttachmentPreset = 'image' | undefined;

export function CaptureRow({
  disabled,
  onPress,
  onPreset,
}: {
  disabled: boolean;
  onPress: () => void;
  onPreset: (preset: AttachmentPreset) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={s.section}>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={[s.capture, disabled && s.disabled]}
      >
        <Lightbulb size={18} color={brandColors.coral} />
        <Text style={s.captureText}>{t('specs.captureWrite')}</Text>
      </TouchableOpacity>
      <View style={s.captureActions}>
        <MiniAction
          icon={<List size={14} color={brandColors.ink} />}
          label={t('specs.attachmentText')}
          onPress={onPress}
        />
        <MiniAction
          icon={<Image size={14} color={brandColors.ink} />}
          label={t('specs.attachmentImage')}
          onPress={() => onPreset('image')}
        />
      </View>
    </View>
  );
}

function MiniAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={s.miniAction}>
      {icon}
      <Text style={s.miniActionText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function IdeaSection(props: {
  title: string;
  ideas: SpecIdea[];
  emptyTitle: string;
  emptyBody: string;
  onOpenIdea: (id: string) => void;
  onArchive?: (idea: SpecIdea) => void;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{props.title}</Text>
      {props.ideas.length > 0 ? (
        <IdeaRows ideas={props.ideas} onOpenIdea={props.onOpenIdea} onArchive={props.onArchive} />
      ) : (
        <EmptyState title={props.emptyTitle} body={props.emptyBody} />
      )}
    </View>
  );
}

export function IdeaRows({
  ideas,
  onOpenIdea,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  ideas: SpecIdea[];
  onOpenIdea: (id: string) => void;
  onArchive?: (idea: SpecIdea) => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (ideas.length === 0) {
    return <EmptyState title={t('specs.nothingArchived')} body={t('specs.nothingArchivedBody')} />;
  }
  return (
    <View style={s.group}>
      {ideas.map((idea, index) => {
        const row = <IdeaRow idea={idea} onOpen={() => onOpenIdea(idea.id)} />;
        return (
          <View key={idea.id}>
            {onArchive ? (
              <Swipeable
                renderRightActions={() => (
                  <RowAction label={t('specs.archiveAction')} onPress={() => onArchive(idea)} />
                )}
              >
                {row}
              </Swipeable>
            ) : onUnarchive ? (
              <Swipeable
                renderRightActions={() => (
                  <>
                    <RowAction
                      label={t('specs.unarchiveAction')}
                      onPress={() => onUnarchive(idea.id)}
                    />
                    {onDelete ? (
                      <RowDeleteAction
                        accessibilityLabel={`Delete ${idea.title}`}
                        onPress={() => onDelete(idea.id)}
                      />
                    ) : null}
                  </>
                )}
              >
                {row}
              </Swipeable>
            ) : (
              row
            )}
            {index < ideas.length - 1 ? <View style={s.divider} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const IDEA_STATUS_KEY: Record<
  IdeaStatus,
  | 'specs.statusOpen'
  | 'specs.statusInterviewing'
  | 'specs.statusConverted'
  | 'specs.statusArchived'
  | 'specs.statusFailed'
> = {
  open: 'specs.statusOpen',
  interviewing: 'specs.statusInterviewing',
  converted: 'specs.statusConverted',
  archived: 'specs.statusArchived',
  failed: 'specs.statusFailed',
};

function IdeaRow({ idea, onOpen }: { idea: SpecIdea; onOpen: () => void }) {
  const { t } = useTranslation();
  const notes = idea.notes.length;
  const attachments = idea.attachments.length;
  const projectLabel =
    idea.targetRepoPath && idea.targetAgentName
      ? `${idea.targetRepoPath} · ${idea.targetAgentName}`
      : t('specs.chooseProjectAgent');
  const metaLine = `${String(notes)} notes · ${String(attachments)} attachments · ${relativeAge(idea.updatedAt)}`;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open ${idea.title}`}
      onPress={onOpen}
      style={s.row}
    >
      <StatusGlyph status={idea.status} />
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={2}>
          {deriveIdeaTitle(idea.title, idea.body)}
        </Text>
        <Text style={s.rowSubtitle} numberOfLines={1}>
          {projectLabel}
        </Text>
        <Text style={s.rowMetaText} numberOfLines={1}>
          {metaLine}
        </Text>
      </View>
      <View style={s.trailing}>
        <Text style={s.statusText}>{t(IDEA_STATUS_KEY[idea.status])}</Text>
        <ChevronRight size={14} color={brandColors.textSoft} />
      </View>
    </TouchableOpacity>
  );
}

export function SpecSection({
  title,
  specs,
  onOpenSpec,
  onDeleteSpec,
}: {
  title: string;
  specs: SpecArtifact[];
  onOpenSpec: (id: string) => void;
  onDeleteSpec?: (id: string) => void;
}) {
  if (specs.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.group}>
        {specs.map((spec, index) => {
          const row = <SpecRow spec={spec} onOpen={() => onOpenSpec(spec.id)} />;
          return (
            <View key={spec.id}>
              {onDeleteSpec ? (
                <Swipeable
                  renderRightActions={() => (
                    <RowDeleteAction
                      accessibilityLabel={`Delete ${spec.title}`}
                      onPress={() => onDeleteSpec(spec.id)}
                    />
                  )}
                >
                  {row}
                </Swipeable>
              ) : (
                row
              )}
              {index < specs.length - 1 ? <View style={s.divider} /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

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

function SpecRow({ spec, onOpen }: { spec: SpecArtifact; onOpen: () => void }) {
  const { t } = useTranslation();
  const version = spec.latestVersion;
  const statusSummary = spec.statusSummary ?? t(SPEC_ACTION_KEY[spec.status]);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open ${spec.title}`}
      onPress={onOpen}
      style={s.row}
    >
      <View style={s.docIcon}>
        <FileText size={17} color={brandColors.ink} />
      </View>
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={2}>
          {spec.title}
        </Text>
        <Text style={s.rowSubtitle} numberOfLines={1}>
          {spec.repoSpecPath}
        </Text>
        <Text style={s.rowMetaText} numberOfLines={1}>
          rev {version?.revision ?? 1} · sha {shortHash(version?.markdownSha256)} · {statusSummary}
        </Text>
      </View>
      <View style={s.trailing}>
        <Text style={s.statusText}>{t(SPEC_STATUS_KEY[spec.status])}</Text>
        <ChevronRight size={14} color={brandColors.textSoft} />
      </View>
    </TouchableOpacity>
  );
}

function StatusGlyph({ status }: { status: SpecIdea['status'] }) {
  const color =
    status === 'failed'
      ? brandColors.error
      : status === 'converted'
        ? brandColors.lime
        : status === 'interviewing'
          ? brandColors.cyan
          : brandColors.coral;
  return (
    <View style={s.ideaIcon}>
      {status === 'converted' ? (
        <CheckCircle2 size={16} color={brandColors.ink} />
      ) : (
        <View style={[s.statusDot, { backgroundColor: color }]} />
      )}
    </View>
  );
}

function RowAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={s.rowAction}>
      <Archive size={16} color={brandColors.ink} />
      <Text style={s.rowActionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function RowDeleteAction({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={s.rowDeleteAction}
    >
      <Trash2 size={16} color={brandColors.error} />
      <Text style={s.rowDeleteText}>{t('specs.deleteRowAction')}</Text>
    </TouchableOpacity>
  );
}

export function EmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      {action ? (
        <TouchableOpacity accessibilityRole="button" onPress={onAction} style={s.emptyAction}>
          <Text style={s.emptyActionText}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

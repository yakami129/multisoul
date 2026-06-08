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
import { Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { brandColors } from '@/theme/brandRefresh';
import { specsHomeStyles as s } from './SpecsHomeStyles';
import {
  deriveIdeaTitle,
  ideaStatusLabel,
  relativeAge,
  shortHash,
  specActionLabel,
  type SpecArtifact,
  type SpecIdea,
  specStatusLabel,
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
  return (
    <View style={s.section}>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={[s.capture, disabled && s.disabled]}
      >
        <Lightbulb size={18} color={brandColors.coral} />
        <Text style={s.captureText}>Write an idea...</Text>
      </TouchableOpacity>
      <View style={s.captureActions}>
        <MiniAction
          icon={<List size={14} color={brandColors.ink} />}
          label="Text"
          onPress={onPress}
        />
        <MiniAction
          icon={<Image size={14} color={brandColors.ink} />}
          label="Image"
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
  if (ideas.length === 0) {
    return (
      <EmptyState title="Nothing archived" body="Archived ideas stay here for traceability." />
    );
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
                  <RowAction label="Archive" onPress={() => onArchive(idea)} />
                )}
              >
                {row}
              </Swipeable>
            ) : onUnarchive ? (
              <Swipeable
                renderRightActions={() => (
                  <>
                    <RowAction label="Unarchive" onPress={() => onUnarchive(idea.id)} />
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

function IdeaRow({ idea, onOpen }: { idea: SpecIdea; onOpen: () => void }) {
  const notes = idea.notes.length;
  const attachments = idea.attachments.length;
  const metadata = [
    idea.targetRepoPath && idea.targetAgentName
      ? `${idea.targetRepoPath} · ${idea.targetAgentName}`
      : 'Choose project & agent',
    `${notes} notes · ${attachments} attachments · ${relativeAge(idea.updatedAt)}`,
  ];
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
          {metadata[0]}
        </Text>
        <Text style={s.rowMetaText} numberOfLines={1}>
          {metadata[1]}
        </Text>
      </View>
      <View style={s.trailing}>
        <Text style={s.statusText}>{ideaStatusLabel(idea.status)}</Text>
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

function SpecRow({ spec, onOpen }: { spec: SpecArtifact; onOpen: () => void }) {
  const version = spec.latestVersion;
  const statusSummary = spec.statusSummary ?? specActionLabel(spec.status);
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
        <Text style={s.statusText}>{specStatusLabel(spec.status)}</Text>
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
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={s.rowDeleteAction}
    >
      <Trash2 size={16} color={brandColors.error} />
      <Text style={s.rowDeleteText}>DELETE</Text>
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

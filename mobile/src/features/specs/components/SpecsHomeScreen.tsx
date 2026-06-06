import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  FileText,
  Image,
  Lightbulb,
  Link,
  List,
  MessageSquare,
  Plus,
  Search,
} from 'lucide-react-native';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Agent, type Endpoint } from '@/types';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { IdeaEditorSheet, type IdeaEditorValue } from './IdeaEditorSheet';
import { TargetPickerSheet } from './TargetPickerSheet';
import {
  deriveIdeaTitle,
  ideaStatusLabel,
  relativeAge,
  shortHash,
  specActionLabel,
  type SpecArtifact,
  type SpecIdea,
  type SpecTarget,
  specStatusLabel,
} from './specUiModels';

type Segment = 'ideas' | 'specs';
type AttachmentPreset = 'link' | 'log' | 'image' | undefined;

interface Props {
  ideas: SpecIdea[];
  specs: SpecArtifact[];
  endpoints?: Endpoint[];
  agents?: Agent[];
  canCreateIdea?: boolean;
  onCreateIdea?: (value: IdeaEditorValue) => void | Promise<void>;
  onOpenIdea: (id: string) => void;
  onOpenSpec: (id: string) => void;
  onArchiveIdea?: (id: string) => void;
  onUnarchiveIdea?: (id: string) => void;
}

const SEGMENTS: Array<{ key: Segment; label: string }> = [
  { key: 'ideas', label: 'Ideas' },
  { key: 'specs', label: 'Specs' },
];

export function SpecsHomeScreen({
  ideas,
  specs,
  endpoints = [],
  agents = [],
  canCreateIdea = true,
  onCreateIdea,
  onOpenIdea,
  onOpenSpec,
  onArchiveIdea,
  onUnarchiveIdea,
}: Props) {
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = React.useState<Segment>('ideas');
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [targetPickerVisible, setTargetPickerVisible] = React.useState(false);
  const [attachmentPreset, setAttachmentPreset] = React.useState<AttachmentPreset>();
  const [draftTarget, setDraftTarget] = React.useState<SpecTarget | undefined>();
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);
  const [undoIdea, setUndoIdea] = React.useState<SpecIdea | null>(null);

  const openEditor = (preset?: AttachmentPreset) => {
    setAttachmentPreset(preset);
    setEditorVisible(true);
  };

  const openIdeas = ideas.filter((idea) =>
    ['open', 'interviewing', 'failed'].includes(idea.status),
  );
  const convertedIdeas = ideas.filter((idea) => idea.status === 'converted');
  const archivedIdeas = ideas.filter((idea) => idea.status === 'archived');
  const needsYou = specs.filter((spec) => spec.status === 'blocked' || spec.status === 'failed');
  const ready = specs.filter((spec) => spec.status === 'ready' || spec.status === 'draft');
  const inProgress = specs.filter((spec) =>
    ['planning', 'implementing'].includes(spec.status),
  );
  const done = specs.filter((spec) => spec.status === 'done');

  const handleArchive = (idea: SpecIdea) => {
    onArchiveIdea?.(idea.id);
    setUndoIdea(idea);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Specs</Text>
          <Text style={s.subtitle}>Ideas into executable plans</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Search specs" style={s.iconButton}>
            <Search size={18} color={brandColors.ink} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="New Idea"
            disabled={!canCreateIdea}
            onPress={() => openEditor()}
            style={[s.iconButton, !canCreateIdea && s.disabled]}
          >
            <Plus size={20} color={canCreateIdea ? brandColors.ink : brandColors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.segment}>
        {SEGMENTS.map((item) => {
          const selected = segment === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setSegment(item.key)}
              style={[s.segmentItem, selected && s.segmentItemActive]}
            >
              <Text style={[s.segmentText, selected && s.segmentTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {needsYou.length > 0 ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => onOpenSpec(needsYou[0].id)}
          style={s.attention}
        >
          <CircleAlert size={16} color={brandColors.coral} />
          <Text style={s.attentionText}>{needsYou.length} item needs your decision</Text>
          <Text style={s.attentionAction}>Review</Text>
        </TouchableOpacity>
      ) : null}

      <ScrollView contentContainerStyle={s.content}>
        {segment === 'ideas' ? (
          <>
            <CaptureRow disabled={!canCreateIdea} onPress={() => openEditor()} onPreset={openEditor} />
            <IdeaSection
              title="Open Ideas"
              ideas={openIdeas}
              emptyTitle="Capture your first idea"
              emptyBody="Start with one sentence. You can add links, logs, and screenshots later."
              onOpenIdea={onOpenIdea}
              onArchive={onArchiveIdea ? handleArchive : undefined}
            />
            <IdeaSection
              title="Converted Recently"
              ideas={convertedIdeas}
              emptyTitle="No converted ideas"
              emptyBody="Saved specs will link back to their source ideas."
              onOpenIdea={onOpenIdea}
            />
            <View style={s.section}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setArchivedExpanded((value) => !value)}
                style={s.sectionHeaderButton}
              >
                <Text style={s.sectionTitle}>Archived</Text>
                <View style={s.sectionHeaderRight}>
                  <Text style={s.sectionCount}>{archivedIdeas.length}</Text>
                  {archivedExpanded ? (
                    <ChevronUp size={16} color={brandColors.textSoft} />
                  ) : (
                    <ChevronDown size={16} color={brandColors.textSoft} />
                  )}
                </View>
              </TouchableOpacity>
              {archivedExpanded ? (
                <IdeaRows ideas={archivedIdeas} onOpenIdea={onOpenIdea} onUnarchive={onUnarchiveIdea} />
              ) : null}
            </View>
          </>
        ) : (
          <>
            <SpecSection title="Needs You" specs={needsYou} onOpenSpec={onOpenSpec} />
            <SpecSection title="Ready" specs={ready} onOpenSpec={onOpenSpec} />
            <SpecSection title="In Progress" specs={inProgress} onOpenSpec={onOpenSpec} />
            <SpecSection title="Done" specs={done} onOpenSpec={onOpenSpec} />
            {specs.length === 0 ? (
              <EmptyState
                title="No saved specs"
                body="Interview an idea, then save a repo spec artifact."
                action="Go to Ideas"
                onAction={() => setSegment('ideas')}
              />
            ) : null}
          </>
        )}
      </ScrollView>

      {undoIdea ? (
        <View style={[s.undo, { bottom: insets.bottom + 96 }]}>
          <Text style={s.undoText}>Archived {deriveIdeaTitle(undoIdea.title, undoIdea.body)}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              onUnarchiveIdea?.(undoIdea.id);
              setUndoIdea(null);
            }}
            style={s.undoButton}
          >
            <Text style={s.undoButtonText}>Undo</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <IdeaEditorSheet
        visible={editorVisible}
        target={draftTarget}
        attachmentPreset={attachmentPreset}
        onChooseTarget={() => setTargetPickerVisible(true)}
        onClose={() => setEditorVisible(false)}
        onSave={(value) => {
          void onCreateIdea?.(value);
          setEditorVisible(false);
        }}
      />
      <TargetPickerSheet
        visible={targetPickerVisible}
        endpoints={endpoints}
        agents={agents}
        selectedTarget={draftTarget}
        onClose={() => setTargetPickerVisible(false)}
        onDone={(target) => {
          setDraftTarget(target);
          setTargetPickerVisible(false);
        }}
      />
    </View>
  );
}

function CaptureRow({
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
        <MiniAction icon={<List size={14} color={brandColors.ink} />} label="Text" onPress={onPress} />
        <MiniAction icon={<Link size={14} color={brandColors.ink} />} label="Link" onPress={() => onPreset('link')} />
        <MiniAction icon={<MessageSquare size={14} color={brandColors.ink} />} label="Log" onPress={() => onPreset('log')} />
        <MiniAction icon={<Image size={14} color={brandColors.ink} />} label="Image" onPress={() => onPreset('image')} />
      </View>
    </View>
  );
}

function MiniAction({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={s.miniAction}>
      {icon}
      <Text style={s.miniActionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function IdeaSection(props: {
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

function IdeaRows({
  ideas,
  onOpenIdea,
  onArchive,
  onUnarchive,
}: {
  ideas: SpecIdea[];
  onOpenIdea: (id: string) => void;
  onArchive?: (idea: SpecIdea) => void;
  onUnarchive?: (id: string) => void;
}) {
  if (ideas.length === 0) return <EmptyState title="Nothing archived" body="Archived ideas stay here for traceability." />;
  return (
    <View style={s.group}>
      {ideas.map((idea, index) => {
        const row = <IdeaRow idea={idea} onOpen={() => onOpenIdea(idea.id)} />;
        return (
          <View key={idea.id}>
            {onArchive ? (
              <Swipeable renderRightActions={() => <RowAction label="Archive" onPress={() => onArchive(idea)} />}>
                {row}
              </Swipeable>
            ) : onUnarchive ? (
              <Swipeable renderRightActions={() => <RowAction label="Unarchive" onPress={() => onUnarchive(idea.id)} />}>
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
    idea.targetRepoPath && idea.targetAgentName ? `${idea.targetRepoPath} · ${idea.targetAgentName}` : 'Choose project & agent',
    `${notes} notes · ${attachments} attachments · ${relativeAge(idea.updatedAt)}`,
  ];
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${idea.title}`} onPress={onOpen} style={s.row}>
      <StatusGlyph status={idea.status} />
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={2}>{deriveIdeaTitle(idea.title, idea.body)}</Text>
        <Text style={s.rowSubtitle} numberOfLines={1}>{metadata[0]}</Text>
        <Text style={s.rowMetaText} numberOfLines={1}>{metadata[1]}</Text>
      </View>
      <View style={s.trailing}>
        <Text style={s.statusText}>{ideaStatusLabel(idea.status)}</Text>
        <ChevronRight size={14} color={brandColors.textSoft} />
      </View>
    </TouchableOpacity>
  );
}

function SpecSection({ title, specs, onOpenSpec }: { title: string; specs: SpecArtifact[]; onOpenSpec: (id: string) => void }) {
  if (specs.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.group}>
        {specs.map((spec, index) => (
          <View key={spec.id}>
            <SpecRow spec={spec} onOpen={() => onOpenSpec(spec.id)} />
            {index < specs.length - 1 ? <View style={s.divider} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function SpecRow({ spec, onOpen }: { spec: SpecArtifact; onOpen: () => void }) {
  const version = spec.latestVersion;
  const statusSummary = spec.statusSummary ?? specActionLabel(spec.status);
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${spec.title}`} onPress={onOpen} style={s.row}>
      <View style={s.docIcon}><FileText size={17} color={brandColors.ink} /></View>
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={2}>{spec.title}</Text>
        <Text style={s.rowSubtitle} numberOfLines={1}>{spec.repoSpecPath}</Text>
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
  const color = status === 'failed' ? brandColors.error : status === 'converted' ? brandColors.lime : status === 'interviewing' ? brandColors.cyan : brandColors.coral;
  return (
    <View style={s.ideaIcon}>
      {status === 'converted' ? <CheckCircle2 size={16} color={brandColors.ink} /> : <View style={[s.statusDot, { backgroundColor: color }]} />}
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

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: brandColors.cream },
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  title: { fontFamily: brandTypography.display, fontSize: 24, lineHeight: 29, fontWeight: '700', color: brandColors.ink },
  subtitle: { marginTop: 2, fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: brandRgba.white88, borderWidth: 1, borderColor: brandColors.silver },
  disabled: { opacity: 0.45 },
  segment: { height: 34, marginHorizontal: 16, marginBottom: 10, borderRadius: 10, backgroundColor: brandRgba.white88, flexDirection: 'row', padding: 3, borderWidth: 1, borderColor: brandColors.silver },
  segmentItem: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentItemActive: { backgroundColor: brandRgba.cyanWash },
  segmentText: { fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  segmentTextActive: { color: brandColors.ink, fontWeight: '700' },
  attention: { minHeight: 44, marginHorizontal: 16, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: brandColors.coral, backgroundColor: brandRgba.white88, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  attentionText: { flex: 1, fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: brandColors.ink },
  attentionAction: { fontFamily: 'Inter', fontSize: 12, fontWeight: '800', color: brandColors.coral },
  content: { paddingHorizontal: 16, paddingBottom: 126, gap: 14 },
  section: { gap: 8 },
  sectionHeaderButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionTitle: { fontFamily: 'Inter', fontSize: 12, fontWeight: '800', color: brandColors.textSoft, textTransform: 'uppercase' },
  sectionCount: { fontFamily: 'Inter', fontSize: 12, fontWeight: '700', color: brandColors.textMuted },
  capture: { minHeight: 52, borderRadius: 14, backgroundColor: brandRgba.white88, borderWidth: 1, borderColor: brandColors.silver, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  captureText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '700', color: brandColors.textSoft },
  captureActions: { flexDirection: 'row', gap: 8 },
  miniAction: { minHeight: 44, flex: 1, borderRadius: 12, backgroundColor: brandRgba.white70, borderWidth: 1, borderColor: brandColors.silver, alignItems: 'center', justifyContent: 'center', gap: 3 },
  miniActionText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '700', color: brandColors.ink },
  group: { borderRadius: 14, backgroundColor: brandRgba.white88, borderWidth: 1, borderColor: brandColors.silver, overflow: 'hidden' },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  ideaIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: brandRgba.cyanSoft },
  docIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: brandRgba.limeSoft },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: 'Inter', fontSize: 14, lineHeight: 18, fontWeight: '800', color: brandColors.ink },
  rowSubtitle: { marginTop: 2, fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  rowMetaText: { marginTop: 2, fontFamily: 'Inter', fontSize: 11, color: brandColors.textMuted },
  trailing: { minWidth: 76, alignItems: 'flex-end', gap: 5 },
  statusText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '800', color: brandColors.ink },
  divider: { height: 1, marginLeft: 54, backgroundColor: brandRgba.silver78 },
  rowAction: { width: 92, backgroundColor: brandRgba.white88, borderLeftWidth: 1, borderLeftColor: brandColors.silver, alignItems: 'center', justifyContent: 'center', gap: 4 },
  rowActionText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '800', color: brandColors.ink },
  empty: { minHeight: 88, borderRadius: 14, backgroundColor: brandRgba.white70, borderWidth: 1, borderColor: brandColors.silver, alignItems: 'center', justifyContent: 'center', padding: 14, gap: 6 },
  emptyTitle: { fontFamily: brandTypography.display, fontSize: 18, lineHeight: 22, fontWeight: '700', color: brandColors.ink, textAlign: 'center' },
  emptyBody: { fontFamily: 'Inter', fontSize: 12, lineHeight: 17, color: brandColors.textSoft, textAlign: 'center' },
  emptyAction: { minHeight: 44, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: brandColors.ink },
  emptyActionText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.white },
  undo: { position: 'absolute', left: 16, right: 16, minHeight: 48, borderRadius: 14, backgroundColor: brandColors.ink, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  undoText: { flex: 1, fontFamily: 'Inter', fontSize: 12, fontWeight: '700', color: brandColors.white },
  undoButton: { minHeight: 44, justifyContent: 'center' },
  undoButtonText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '900', color: brandColors.lime },
});

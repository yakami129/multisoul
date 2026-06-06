import { ChevronDown, ChevronUp, CircleAlert, Plus, Search } from 'lucide-react-native';
import React from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors } from '@/theme/brandRefresh';
import { type Agent, type Endpoint } from '@/types';
import { IdeaEditorSheet, type IdeaEditorValue } from './IdeaEditorSheet';
import {
  CaptureRow,
  EmptyState,
  IdeaRows,
  IdeaSection,
  SpecSection,
  type AttachmentPreset,
} from './SpecsHomeRows';
import { specsHomeStyles as s } from './SpecsHomeStyles';
import { deriveIdeaTitle, type SpecArtifact, type SpecIdea, type SpecTarget } from './specUiModels';
import { TargetPickerSheet } from './TargetPickerSheet';

type Segment = 'ideas' | 'specs';

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
  onDeleteArchivedIdea?: (id: string) => void;
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
  onDeleteArchivedIdea,
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
  const inProgress = specs.filter((spec) => ['planning', 'implementing'].includes(spec.status));
  const done = specs.filter((spec) => spec.status === 'done');

  const handleArchive = (idea: SpecIdea) => {
    onArchiveIdea?.(idea.id);
    setUndoIdea(idea);
  };

  const handleDeleteIdea = (ideaId: string) => {
    Alert.alert(
      'Delete idea?',
      'This idea will be permanently removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteArchivedIdea?.(ideaId),
        },
      ],
    );
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Specs</Text>
          <Text style={s.subtitle}>Ideas into executable plans</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Search specs"
            style={s.iconButton}
          >
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
            <CaptureRow
              disabled={!canCreateIdea}
              onPress={() => openEditor()}
              onPreset={openEditor}
            />
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
                <IdeaRows
                  ideas={archivedIdeas}
                  onOpenIdea={onOpenIdea}
                  onUnarchive={onUnarchiveIdea}
                  onDelete={handleDeleteIdea}
                />
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
      >
        <TargetPickerSheet
          visible={targetPickerVisible}
          endpoints={endpoints}
          agents={agents}
          selectedTarget={draftTarget}
          presentation="inline"
          onClose={() => setTargetPickerVisible(false)}
          onDone={(target) => {
            setDraftTarget(target);
            setTargetPickerVisible(false);
          }}
        />
      </IdeaEditorSheet>
    </View>
  );
}

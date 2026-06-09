import { ChevronDown, ChevronUp, CircleAlert, Plus, Search } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
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
import { type SpecArtifact, type SpecIdea, type SpecTarget } from './specUiModels';
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
  onDeleteSpec?: (id: string) => void;
}

type SegmentKey = Segment;

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
  onDeleteSpec,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = React.useState<Segment>('ideas');

  const segments: Array<{ key: SegmentKey; label: string }> = [
    { key: 'ideas', label: t('specs.segmentIdeas') },
    { key: 'specs', label: t('specs.segmentSpecs') },
  ];
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [targetPickerVisible, setTargetPickerVisible] = React.useState(false);
  const [attachmentPreset, setAttachmentPreset] = React.useState<AttachmentPreset>();
  const [draftTarget, setDraftTarget] = React.useState<SpecTarget | undefined>();
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);

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
  };

  const handleDeleteIdea = (ideaId: string) => {
    Alert.alert(t('specs.deleteIdea'), t('specs.deleteIdeaBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('specs.delete'),
        style: 'destructive',
        onPress: () => onDeleteArchivedIdea?.(ideaId),
      },
    ]);
  };

  const handleDeleteSpec = (specId: string) => {
    Alert.alert(t('specs.deleteSpec'), t('specs.deleteSpecBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('specs.delete'),
        style: 'destructive',
        onPress: () => onDeleteSpec?.(specId),
      },
    ]);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>{t('specs.title')}</Text>
          <Text style={s.subtitle}>{t('specs.subtitle')}</Text>
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
        {segments.map((item) => {
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
          <Text style={s.attentionText}>
            {t('specs.needsDecision', { count: needsYou.length })}
          </Text>
          <Text style={s.attentionAction}>{t('specs.review')}</Text>
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
              title={t('specs.openIdeas')}
              ideas={openIdeas}
              emptyTitle={t('specs.captureFirst')}
              emptyBody={t('specs.captureFirstBody')}
              onOpenIdea={onOpenIdea}
              onArchive={onArchiveIdea ? handleArchive : undefined}
            />
            <IdeaSection
              title={t('specs.convertedRecently')}
              ideas={convertedIdeas}
              emptyTitle={t('specs.noConverted')}
              emptyBody={t('specs.noConvertedBody')}
              onOpenIdea={onOpenIdea}
            />
            <View style={s.section}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setArchivedExpanded((value) => !value)}
                style={s.sectionHeaderButton}
              >
                <Text style={s.sectionTitle}>{t('specs.archived')}</Text>
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
            <SpecSection
              title={t('specs.needsYou')}
              specs={needsYou}
              onOpenSpec={onOpenSpec}
              onDeleteSpec={onDeleteSpec ? handleDeleteSpec : undefined}
            />
            <SpecSection
              title={t('specs.ready')}
              specs={ready}
              onOpenSpec={onOpenSpec}
              onDeleteSpec={onDeleteSpec ? handleDeleteSpec : undefined}
            />
            <SpecSection
              title={t('specs.inProgress')}
              specs={inProgress}
              onOpenSpec={onOpenSpec}
              onDeleteSpec={onDeleteSpec ? handleDeleteSpec : undefined}
            />
            <SpecSection
              title={t('specs.done')}
              specs={done}
              onOpenSpec={onOpenSpec}
              onDeleteSpec={onDeleteSpec ? handleDeleteSpec : undefined}
            />
            {specs.length === 0 ? (
              <EmptyState
                title={t('specs.noSavedSpecs')}
                body={t('specs.noSavedSpecsBody')}
                action={t('specs.goToIdeas')}
                onAction={() => setSegment('ideas')}
              />
            ) : null}
          </>
        )}
      </ScrollView>

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

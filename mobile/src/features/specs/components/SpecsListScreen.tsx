import { ChevronRight, FileText, Plus } from 'lucide-react-native';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type SpecDraft, type SpecStatus } from '../types';

interface Props {
  specs: SpecDraft[];
  onCreateSpec: () => void;
  onOpenSpec: (id: string) => void;
  onDeleteSpec?: (id: string) => void;
  canCreate?: boolean;
}

type Segment = 'draft' | 'review' | 'dispatched';

const SEGMENTS: Array<{ key: Segment; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'review', label: 'Review' },
  { key: 'dispatched', label: 'Dispatched' },
];

function displayStatus(status: SpecStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'review':
      return 'Review';
    case 'approved':
      return 'Approved';
    case 'dispatching':
      return 'Dispatching';
    case 'dispatched':
      return 'Dispatched';
    case 'running':
      return 'Running';
    case 'blocked':
      return 'Blocked';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

function segmentForStatus(status: SpecStatus): Segment {
  if (status === 'draft') return 'draft';
  if (status === 'review') return 'review';
  return 'dispatched';
}

function relativeAge(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SpecsListScreen({
  specs,
  onCreateSpec,
  onOpenSpec,
  onDeleteSpec,
  canCreate = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = React.useState<Segment>('draft');
  const openSwipeableRef = React.useRef<Swipeable | null>(null);
  const swipeableRefs = React.useRef<Map<string, Swipeable>>(new Map());
  const visibleSpecs = React.useMemo(
    () => specs.filter((spec) => segmentForStatus(spec.status) === segment),
    [segment, specs],
  );

  const renderDeleteAction = (spec: SpecDraft) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Delete ${spec.title}`}
      onPress={() => onDeleteSpec?.(spec.id)}
      style={s.deleteAction}
    >
      <Text style={s.deleteText}>DELETE</Text>
    </TouchableOpacity>
  );

  const renderSpecRow = (spec: SpecDraft) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open ${spec.title}`}
      onPress={() => onOpenSpec(spec.id)}
      style={s.row}
    >
      <View style={s.docIcon}>
        <FileText size={16} color={brandColors.coral} />
      </View>
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {spec.title}
        </Text>
        <Text style={s.rowSubtitle} numberOfLines={1}>
          {spec.targetRepoPath}
        </Text>
      </View>
      <View style={s.rowMeta}>
        <Text style={s.status} numberOfLines={1}>
          {displayStatus(spec.status)}
        </Text>
        <Text style={s.age} numberOfLines={1}>
          {relativeAge(spec.updatedAt)}
        </Text>
      </View>
      <ChevronRight size={14} color={brandColors.textSoft} />
    </TouchableOpacity>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Specs</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="New Spec"
          disabled={!canCreate}
          onPress={onCreateSpec}
          style={[s.addButton, !canCreate && s.addButtonDisabled]}
        >
          <Plus size={20} color={canCreate ? brandColors.ink : brandColors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={s.newSpecRow}>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={!canCreate}
          onPress={onCreateSpec}
          style={[s.newSpecButton, !canCreate && s.newSpecButtonDisabled]}
        >
          <FileText size={15} color={canCreate ? brandColors.white : brandColors.textDisabled} />
          <Text style={[s.newSpecText, !canCreate && s.newSpecTextDisabled]}>New Spec</Text>
        </TouchableOpacity>
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

      <ScrollView contentContainerStyle={visibleSpecs.length === 0 ? s.emptyContent : s.content}>
        {visibleSpecs.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>
              {specs.length === 0 ? 'Create your first spec' : `No ${segment} specs`}
            </Text>
            <Text style={s.emptyDesc}>
              {canCreate
                ? 'Interview requirements, generate a SPEC.md preview, and dispatch it to an agent.'
                : 'Connect a machine before creating specs.'}
            </Text>
          </View>
        ) : (
          <View style={s.group}>
            {visibleSpecs.map((spec, index) => (
              <View key={spec.id}>
                {onDeleteSpec ? (
                  <Swipeable
                    ref={(ref) => {
                      if (ref) swipeableRefs.current.set(spec.id, ref);
                      else swipeableRefs.current.delete(spec.id);
                    }}
                    onSwipeableOpen={() => {
                      if (openSwipeableRef.current) openSwipeableRef.current.close();
                      openSwipeableRef.current = swipeableRefs.current.get(spec.id) ?? null;
                    }}
                    renderRightActions={() => renderDeleteAction(spec)}
                    overshootRight={false}
                  >
                    {renderSpecRow(spec)}
                  </Swipeable>
                ) : (
                  renderSpecRow(spec)
                )}
                {index < visibleSpecs.length - 1 ? <View style={s.divider} /> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: brandColors.cream },
  header: {
    minHeight: 68,
    backgroundColor: brandColors.cream,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontFamily: brandTypography.display,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '700',
    color: brandColors.ink,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: { opacity: 0.5 },
  newSpecRow: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 8 },
  newSpecButton: {
    height: 38,
    borderRadius: 10,
    backgroundColor: brandColors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  newSpecButtonDisabled: { backgroundColor: brandRgba.ink18 },
  newSpecText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: brandColors.white },
  newSpecTextDisabled: { color: brandColors.textDisabled },
  segment: {
    height: 32,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    backgroundColor: brandRgba.white88,
    flexDirection: 'row',
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: { backgroundColor: brandRgba.cyanWash },
  segmentText: { fontFamily: 'Inter', fontSize: 11, color: brandColors.textSoft },
  segmentTextActive: { color: brandColors.ink, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 126 },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 126,
  },
  emptyWrap: { alignItems: 'center', gap: 8 },
  emptyTitle: {
    fontFamily: brandTypography.display,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: brandColors.ink,
  },
  emptyDesc: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: brandColors.textSoft,
    textAlign: 'center',
    lineHeight: 19,
  },
  group: {
    borderRadius: 18,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    overflow: 'hidden',
  },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 8,
  },
  docIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: brandRgba.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: brandColors.ink,
  },
  rowSubtitle: { marginTop: 2, fontFamily: 'Inter', fontSize: 11, color: brandColors.textSoft },
  rowMeta: { alignItems: 'flex-end', gap: 2, maxWidth: 84 },
  status: { fontFamily: 'Inter', fontSize: 10, fontWeight: '700', color: brandColors.coral },
  age: { fontFamily: 'Inter', fontSize: 10, color: brandColors.textMuted },
  divider: { height: 1, backgroundColor: brandRgba.silver78, marginLeft: 51 },
  deleteAction: {
    width: 74,
    backgroundColor: brandColors.white,
    borderLeftWidth: 1,
    borderLeftColor: brandColors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '700', color: brandColors.error },
});

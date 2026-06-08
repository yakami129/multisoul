import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { RECURRING_TEMPLATES, WATCH_TEMPLATES, type WorkflowTemplate } from '../templates';
import { workflowScreenStyles as s } from './workflowScreenStyles';

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

function formatRecurringSchedule(initialValues: WorkflowTemplate['initial_values']): string {
  if (initialValues.schedule_kind === 'weekly') {
    const weekday =
      initialValues.day_of_week != null ? WEEKDAY_LABELS[initialValues.day_of_week] : null;
    return `Weekly ${weekday ?? ''} ${initialValues.time_of_day ?? ''}`.replace(/\s+/g, ' ').trim();
  }
  return `Daily ${initialValues.time_of_day ?? ''}`;
}

function formatWatchSchedule(initialValues: WorkflowTemplate['initial_values']): string {
  const duration = initialValues.duration_minutes ?? 60;
  const interval = initialValues.interval_minutes ?? 10;
  return `${duration} min · every ${interval} min`;
}

interface Props {
  onSelectBlank: () => void;
  onSelectTemplate: (template: WorkflowTemplate) => void;
  onCancel: () => void;
}

export function WorkflowTemplatePickerScreen({ onSelectBlank, onSelectTemplate, onCancel }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.pickerRoot, { paddingTop: insets.top }]}>
      <View style={s.pickerHeader}>
        <TouchableOpacity onPress={onCancel} accessibilityRole="button">
          <Text style={s.pickerCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.pickerTitle}>New Workflow</Text>
        <View style={s.pickerHeaderSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[s.pickerContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Blank workflow card */}
        <TouchableOpacity
          style={[s.templateCard, s.blankTemplateCard]}
          onPress={onSelectBlank}
          accessibilityRole="button"
          accessibilityLabel="Use Blank Workflow"
          testID="workflow-template-blank"
        >
          <Text style={s.blankEyebrow}>START FROM SCRATCH</Text>
          <Text style={s.blankTitle}>Blank Workflow</Text>
          <Text style={s.templateDescription}>Create a workflow with no prefilled prompt.</Text>
          <Text style={s.blankSchedule}>Default: Daily 09:00 · or Watch mode</Text>
        </TouchableOpacity>

        {/* Recurring Templates section */}
        <Text style={s.templateSectionLabel}>RECURRING TEMPLATES</Text>

        {RECURRING_TEMPLATES.map((template) => (
          <TouchableOpacity
            key={template.id}
            style={s.templateCard}
            onPress={() => onSelectTemplate(template)}
            accessibilityRole="button"
            accessibilityLabel={`Use ${template.title}`}
            testID={`workflow-template-${template.id}`}
          >
            <View style={s.templateHeaderRow}>
              <Text style={s.templateTitle} numberOfLines={1}>
                {template.title}
              </Text>
              <View style={s.templateScheduleChip}>
                <Text style={s.templateScheduleText} numberOfLines={1}>
                  {formatRecurringSchedule(template.initial_values)}
                </Text>
              </View>
            </View>

            <Text style={s.templateDescription} numberOfLines={2}>
              {template.description}
            </Text>

            <View style={s.templateBoundaryBlock}>
              <Text style={s.templateBoundaryLabel} numberOfLines={1}>
                {template.boundary_label}
              </Text>
              <Text style={s.templateBoundaryDescription} numberOfLines={2}>
                {template.boundary_description}
              </Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Watch Templates section */}
        <Text style={s.templateSectionLabel}>WATCH TEMPLATES</Text>

        {WATCH_TEMPLATES.map((template) => (
          <TouchableOpacity
            key={template.id}
            style={[s.templateCard, watchCardStyle]}
            onPress={() => onSelectTemplate(template)}
            accessibilityRole="button"
            accessibilityLabel={`Use ${template.title}`}
            testID={`workflow-template-${template.id}`}
          >
            <View style={s.templateHeaderRow}>
              <Text style={s.templateTitle} numberOfLines={1}>
                {template.title}
              </Text>
              <View style={watchChipStyle}>
                <Text style={watchChipTextStyle}>WATCH</Text>
              </View>
            </View>

            <Text style={watchScheduleText} numberOfLines={1}>
              {formatWatchSchedule(template.initial_values)}
            </Text>

            <Text style={s.templateDescription} numberOfLines={2}>
              {template.description}
            </Text>

            <View style={s.templateBoundaryBlock}>
              <Text style={s.templateBoundaryLabel} numberOfLines={1}>
                {template.boundary_label}
              </Text>
              <Text style={s.templateBoundaryDescription} numberOfLines={2}>
                Ask before: push, merge, release, rollback, delete, migration
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const watchCardStyle = {
  borderColor: brandColors.coral,
};

const watchChipStyle = {
  flexShrink: 0 as const,
  borderRadius: 8,
  backgroundColor: brandRgba.coralSoft,
  paddingHorizontal: 7,
  paddingVertical: 3,
};

const watchChipTextStyle = {
  fontFamily: 'Inter' as const,
  fontSize: 10,
  lineHeight: 12,
  fontWeight: '700' as const,
  color: brandColors.coral,
};

const watchScheduleText = {
  fontFamily: 'Inter' as const,
  fontSize: 11,
  lineHeight: 14,
  color: brandColors.textSoft,
  marginBottom: 4,
};

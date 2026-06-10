import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { getRecurringTemplates, getWatchTemplates, type WorkflowTemplate } from '../templates';
import { workflowScreenStyles as s } from './workflowScreenStyles';

const WEEKDAY_KEYS = {
  1: 'workflows.weekdayMon',
  2: 'workflows.weekdayTue',
  3: 'workflows.weekdayWed',
  4: 'workflows.weekdayThu',
  5: 'workflows.weekdayFri',
  6: 'workflows.weekdaySat',
  7: 'workflows.weekdaySun',
} as const;

function formatRecurringSchedule(
  initialValues: WorkflowTemplate['initial_values'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (initialValues.schedule_kind === 'weekly') {
    const weekday =
      initialValues.day_of_week != null
        ? t(WEEKDAY_KEYS[initialValues.day_of_week as keyof typeof WEEKDAY_KEYS])
        : '';
    return t('workflows.picker.scheduleWeekly', { weekday, time: initialValues.time_of_day ?? '' })
      .replace(/\s+/g, ' ')
      .trim();
  }
  return t('workflows.picker.scheduleDaily', { time: initialValues.time_of_day ?? '' });
}

function formatWatchSchedule(
  initialValues: WorkflowTemplate['initial_values'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const duration = initialValues.duration_minutes ?? 60;
  const interval = initialValues.interval_minutes ?? 10;
  return t('workflows.picker.watchSchedule', { duration, interval });
}

interface Props {
  onSelectBlank: () => void;
  onSelectTemplate: (template: WorkflowTemplate) => void;
  onCancel: () => void;
}

export function WorkflowTemplatePickerScreen({ onSelectBlank, onSelectTemplate, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const recurringTemplates = getRecurringTemplates();
  const watchTemplates = getWatchTemplates();

  return (
    <View style={[s.pickerRoot, { paddingTop: insets.top }]}>
      <View style={s.pickerHeader}>
        <TouchableOpacity onPress={onCancel} accessibilityRole="button">
          <Text style={s.pickerCancel}>{t('workflows.cancel')}</Text>
        </TouchableOpacity>
        <Text style={s.pickerTitle}>{t('workflows.titleNew')}</Text>
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
          accessibilityLabel={t('workflows.picker.blankWorkflow')}
          testID="workflow-template-blank"
        >
          <Text style={s.blankEyebrow}>{t('workflows.picker.startFromScratch')}</Text>
          <Text style={s.blankTitle}>{t('workflows.picker.blankWorkflow')}</Text>
          <Text style={s.templateDescription}>{t('workflows.picker.blankDescription')}</Text>
          <Text style={s.blankSchedule}>{t('workflows.picker.blankSchedule')}</Text>
        </TouchableOpacity>

        {/* Recurring Templates section */}
        <Text style={s.templateSectionLabel}>{t('workflows.picker.recurringSection')}</Text>

        {recurringTemplates.map((template) => (
          <TouchableOpacity
            key={template.id}
            style={s.templateCard}
            onPress={() => onSelectTemplate(template)}
            accessibilityRole="button"
            accessibilityLabel={template.title}
            testID={`workflow-template-${template.id}`}
          >
            <View style={s.templateHeaderRow}>
              <Text style={s.templateTitle} numberOfLines={1}>
                {template.title}
              </Text>
              <View style={s.templateScheduleChip}>
                <Text style={s.templateScheduleText} numberOfLines={1}>
                  {formatRecurringSchedule(template.initial_values, t)}
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
        <Text style={s.templateSectionLabel}>{t('workflows.picker.watchSection')}</Text>

        {watchTemplates.map((template) => (
          <TouchableOpacity
            key={template.id}
            style={[s.templateCard, watchCardStyle]}
            onPress={() => onSelectTemplate(template)}
            accessibilityRole="button"
            accessibilityLabel={template.title}
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

            <Text style={watchScheduleTextStyle} numberOfLines={1}>
              {formatWatchSchedule(template.initial_values, t)}
            </Text>

            <Text style={s.templateDescription} numberOfLines={2}>
              {template.description}
            </Text>

            <View style={s.templateBoundaryBlock}>
              <Text style={s.templateBoundaryLabel} numberOfLines={1}>
                {template.boundary_label}
              </Text>
              <Text style={s.templateBoundaryDescription} numberOfLines={2}>
                {t('workflows.picker.watchAskBefore')}
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

const watchScheduleTextStyle = {
  fontFamily: 'Inter' as const,
  fontSize: 11,
  lineHeight: 14,
  color: brandColors.textSoft,
  marginBottom: 4,
};

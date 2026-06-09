import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import { type Agent } from '@/types';
import { type WorkflowInput, type WorkflowMode, type WorkflowScheduleKind } from '../types';
import { workflowScreenStyles as s } from './workflowScreenStyles';

const INTERVAL_PRESETS = [5, 10, 15, 30] as const;
const DURATION_PRESETS = [30, 60, 120] as const;

function normalizeTimeOfDay(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export interface WorkflowFormInitialValues {
  name?: string;
  agent_id?: string;
  prompt?: string;
  mode?: WorkflowMode;
  schedule_kind?: WorkflowScheduleKind | null;
  time_of_day?: string | null;
  day_of_week?: number | null;
  interval_minutes?: number | null;
  max_runs?: number | null;
  expires_at?: number | null;
  stop_condition?: string | null;
  // template helper: duration in minutes
  duration_minutes?: number;
}

interface Props {
  agents: Agent[];
  initialValues?: WorkflowFormInitialValues;
  title?: string;
  showModeSelector?: boolean;
  onSave: (input: WorkflowInput) => void;
  onCancel: () => void;
}

export function WorkflowFormScreen({
  agents,
  initialValues,
  title = 'Workflow',
  showModeSelector,
  onSave,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initialValues?.name ?? '');

  const weekdays = [
    { label: t('workflows.weekdayMon'), value: 1 },
    { label: t('workflows.weekdayTue'), value: 2 },
    { label: t('workflows.weekdayWed'), value: 3 },
    { label: t('workflows.weekdayThu'), value: 4 },
    { label: t('workflows.weekdayFri'), value: 5 },
    { label: t('workflows.weekdaySat'), value: 6 },
    { label: t('workflows.weekdaySun'), value: 7 },
  ];
  const [agentId, setAgentId] = useState(initialValues?.agent_id ?? agents[0]?.id ?? '');
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? '');

  // Mode: show selector only when showModeSelector is true (blank workflow) or not set and mode is from template
  const templateMode = initialValues?.mode;
  const canSelectMode = showModeSelector !== false && !templateMode;
  const [mode, setMode] = useState<WorkflowMode>(templateMode ?? 'recurring');

  // Recurring fields
  const [scheduleKind, setScheduleKind] = useState<WorkflowScheduleKind>(
    (initialValues?.schedule_kind as WorkflowScheduleKind | null | undefined) ?? 'daily',
  );
  const [timeOfDay, setTimeOfDay] = useState(initialValues?.time_of_day ?? '09:00');
  const [dayOfWeek, setDayOfWeek] = useState<number>(initialValues?.day_of_week ?? 1);

  // Watch fields
  const [intervalMinutes, setIntervalMinutes] = useState<number>(
    initialValues?.interval_minutes ?? 10,
  );
  const [customInterval, setCustomInterval] = useState(
    String(initialValues?.interval_minutes ?? 10),
  );
  const [useCustomInterval, setUseCustomInterval] = useState(
    initialValues?.interval_minutes != null &&
      !INTERVAL_PRESETS.includes(
        initialValues.interval_minutes as (typeof INTERVAL_PRESETS)[number],
      ),
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(
    initialValues?.duration_minutes ?? 60,
  );
  const [maxRuns, setMaxRuns] = useState(
    initialValues?.max_runs != null ? String(initialValues.max_runs) : '',
  );
  const [stopCondition, setStopCondition] = useState(initialValues?.stop_condition ?? '');

  useEffect(() => {
    if (agentId.length > 0) return;
    if (initialValues?.agent_id && agents.some((agent) => agent.id === initialValues.agent_id)) {
      setAgentId(initialValues.agent_id);
      return;
    }
    if (agents[0]) setAgentId(agents[0].id);
  }, [agentId, agents, initialValues?.agent_id]);

  const normalizedTimeOfDay = normalizeTimeOfDay(timeOfDay);
  const effectiveInterval = useCustomInterval ? Number(customInterval) : intervalMinutes;
  const intervalValid =
    Number.isInteger(effectiveInterval) && effectiveInterval >= 1 && effectiveInterval <= 240;

  const canSaveRecurring =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    agentId.length > 0 &&
    normalizedTimeOfDay !== null;

  const canSaveWatch =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    agentId.length > 0 &&
    intervalValid &&
    (maxRuns === '' || (Number.isInteger(Number(maxRuns)) && Number(maxRuns) > 0));

  const canSave = mode === 'watch' ? canSaveWatch : canSaveRecurring;

  function handleSave() {
    if (!canSave) return;
    if (mode === 'watch') {
      const maxRunsNum = maxRuns !== '' ? Number(maxRuns) : null;
      const expiresAt = Date.now() + durationMinutes * 60_000;
      onSave({
        name: name.trim(),
        agent_id: agentId,
        prompt: prompt.trim(),
        mode: 'watch',
        interval_minutes: effectiveInterval,
        max_runs: maxRunsNum,
        expires_at: expiresAt,
        stop_condition: stopCondition.trim() || undefined,
      });
    } else {
      if (normalizedTimeOfDay === null) return;
      onSave({
        name: name.trim(),
        agent_id: agentId,
        prompt: prompt.trim(),
        mode: 'recurring',
        schedule_kind: scheduleKind,
        time_of_day: normalizedTimeOfDay,
        day_of_week: scheduleKind === 'weekly' ? dayOfWeek : null,
      });
    }
  }

  return (
    <KeyboardAvoidingView
      style={[s.formRoot, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.formHeader}>
        <TouchableOpacity onPress={onCancel} accessibilityRole="button">
          <Text style={s.formCancel}>{t('workflows.cancel')}</Text>
        </TouchableOpacity>
        <Text style={s.formTitle}>{title}</Text>
        <TouchableOpacity onPress={handleSave} accessibilityRole="button" disabled={!canSave}>
          <Text style={[s.formSave, !canSave && s.formSaveDisabled]}>{t('workflows.save')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[s.formContent, { paddingBottom: insets.bottom + 120 }]}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {/* Mode selector (only for blank workflow) */}
        {canSelectMode && (
          <>
            <Text style={s.fieldLabel}>{t('workflows.modeLabel')}</Text>
            <View style={s.segment}>
              {(['recurring', 'watch'] as WorkflowMode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[s.segmentItem, mode === m && s.segmentItemActive]}
                  onPress={() => setMode(m)}
                  accessibilityRole="button"
                >
                  <Text style={[s.segmentText, mode === m && s.segmentTextActive]}>
                    {m === 'recurring' ? t('workflows.modeRecurring') : t('workflows.modeWatch')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <Text style={s.fieldLabel}>{t('workflows.nameLabel')}</Text>
        <TextInput
          style={s.textInput}
          value={name}
          onChangeText={setName}
          placeholder={t('workflows.namePlaceholder')}
          placeholderTextColor={brandColors.textMuted}
        />

        <Text style={s.fieldLabel}>{t('workflows.agentLabel')}</Text>
        {agents.map((agent) => (
          <TouchableOpacity
            key={agent.id}
            style={[s.agentRow, agentId === agent.id && s.agentRowSelected]}
            onPress={() => setAgentId(agent.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: agentId === agent.id }}
          >
            <View style={s.agentCopy}>
              <Text style={s.agentName} numberOfLines={1}>
                {agent.name}
              </Text>
              <Text style={s.agentEndpoint} numberOfLines={1}>
                {agent.endpoint_label}
              </Text>
            </View>
            {agentId === agent.id && (
              <Switch
                value
                disabled
                trackColor={{ false: brandRgba.ink18, true: brandColors.cyan }}
              />
            )}
          </TouchableOpacity>
        ))}

        {mode === 'recurring' ? (
          <>
            <Text style={s.fieldLabel}>{t('workflows.scheduleLabel')}</Text>
            <View style={s.segment}>
              {(['daily', 'weekly'] as WorkflowScheduleKind[]).map((kind) => (
                <TouchableOpacity
                  key={kind}
                  style={[s.segmentItem, scheduleKind === kind && s.segmentItemActive]}
                  onPress={() => setScheduleKind(kind)}
                  accessibilityRole="button"
                >
                  <Text style={[s.segmentText, scheduleKind === kind && s.segmentTextActive]}>
                    {kind === 'daily'
                      ? t('workflows.scheduleDaily')
                      : t('workflows.scheduleWeekly')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>{t('workflows.timeLabel')}</Text>
            <TextInput
              style={s.textInput}
              value={timeOfDay}
              onChangeText={setTimeOfDay}
              placeholder="HH:MM"
              placeholderTextColor={brandColors.textMuted}
              keyboardType="numbers-and-punctuation"
            />

            {scheduleKind === 'weekly' && (
              <>
                <Text style={s.fieldLabel}>{t('workflows.weekdayLabel')}</Text>
                <View style={s.segment}>
                  {weekdays.map((day) => (
                    <TouchableOpacity
                      key={day.value}
                      style={[s.segmentItem, dayOfWeek === day.value && s.segmentItemActive]}
                      onPress={() => setDayOfWeek(day.value)}
                      accessibilityRole="button"
                    >
                      <Text style={[s.segmentText, dayOfWeek === day.value && s.segmentTextActive]}>
                        {day.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </>
        ) : (
          <>
            <Text style={s.fieldLabel}>{t('workflows.intervalLabel')}</Text>
            <View style={s.segment}>
              {INTERVAL_PRESETS.map((mins) => (
                <TouchableOpacity
                  key={mins}
                  style={[
                    s.segmentItem,
                    !useCustomInterval && intervalMinutes === mins && s.segmentItemActive,
                  ]}
                  onPress={() => {
                    setIntervalMinutes(mins);
                    setUseCustomInterval(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      s.segmentText,
                      !useCustomInterval && intervalMinutes === mins && s.segmentTextActive,
                    ]}
                  >
                    {`${mins}m`}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[s.segmentItem, useCustomInterval && s.segmentItemActive]}
                onPress={() => setUseCustomInterval(true)}
                accessibilityRole="button"
              >
                <Text style={[s.segmentText, useCustomInterval && s.segmentTextActive]}>
                  {t('workflows.intervalCustom')}
                </Text>
              </TouchableOpacity>
            </View>

            {useCustomInterval && (
              <TextInput
                style={s.textInput}
                value={customInterval}
                onChangeText={setCustomInterval}
                placeholder={t('workflows.intervalPlaceholder')}
                placeholderTextColor={brandColors.textMuted}
                keyboardType="number-pad"
              />
            )}

            <Text style={s.fieldLabel}>{t('workflows.durationLabel')}</Text>
            <View style={s.segment}>
              {DURATION_PRESETS.map((mins) => (
                <TouchableOpacity
                  key={mins}
                  style={[s.segmentItem, durationMinutes === mins && s.segmentItemActive]}
                  onPress={() => setDurationMinutes(mins)}
                  accessibilityRole="button"
                >
                  <Text style={[s.segmentText, durationMinutes === mins && s.segmentTextActive]}>
                    {`${mins}m`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>{t('workflows.maxRunsLabel')}</Text>
            <TextInput
              style={s.textInput}
              value={maxRuns}
              onChangeText={setMaxRuns}
              placeholder={t('workflows.maxRunsPlaceholder')}
              placeholderTextColor={brandColors.textMuted}
              keyboardType="number-pad"
            />

            <Text style={s.fieldLabel}>{t('workflows.stopConditionLabel')}</Text>
            <TextInput
              style={[s.textInput, s.textInputMultiline]}
              value={stopCondition}
              onChangeText={setStopCondition}
              placeholder={t('workflows.stopConditionPlaceholder')}
              placeholderTextColor={brandColors.textMuted}
              multiline
            />

            <View style={watchNoticeContainer}>
              <Text style={watchNoticeText}>{t('workflows.watchNotice')}</Text>
            </View>
          </>
        )}

        <Text style={s.fieldLabel}>{t('workflows.promptLabel')}</Text>
        <TextInput
          style={[s.textInput, s.textInputMultiline]}
          value={prompt}
          onChangeText={setPrompt}
          placeholder={t('workflows.promptPlaceholder')}
          placeholderTextColor={brandColors.textMuted}
          multiline
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const watchNoticeContainer = {
  marginTop: 14,
  padding: 10,
  backgroundColor: brandRgba.coralSoft,
  borderRadius: 8,
};

const watchNoticeText = {
  fontFamily: 'Inter' as const,
  fontSize: 11,
  lineHeight: 15,
  color: brandColors.coral,
};

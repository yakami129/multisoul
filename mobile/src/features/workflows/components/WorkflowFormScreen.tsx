import React, { useEffect, useState } from 'react';
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
import { type WorkflowInput, type WorkflowScheduleKind } from '../types';
import { workflowScreenStyles as s } from './workflowScreenStyles';

const WEEKDAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
];

function normalizeTimeOfDay(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

interface Props {
  agents: Agent[];
  initialValues?: Partial<WorkflowInput>;
  onSave: (input: WorkflowInput) => void;
  onCancel: () => void;
}

export function WorkflowFormScreen({ agents, initialValues, onSave, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initialValues?.name ?? '');
  const [agentId, setAgentId] = useState(initialValues?.agent_id ?? agents[0]?.id ?? '');
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? '');
  const [scheduleKind, setScheduleKind] = useState<WorkflowScheduleKind>(
    initialValues?.schedule_kind ?? 'daily',
  );
  const [timeOfDay, setTimeOfDay] = useState(initialValues?.time_of_day ?? '09:00');
  const [dayOfWeek, setDayOfWeek] = useState<number>(initialValues?.day_of_week ?? 1);

  useEffect(() => {
    if (agentId.length > 0) return;
    if (initialValues?.agent_id && agents.some((agent) => agent.id === initialValues.agent_id)) {
      setAgentId(initialValues.agent_id);
      return;
    }
    if (agents[0]) setAgentId(agents[0].id);
  }, [agentId, agents, initialValues?.agent_id]);

  const normalizedTimeOfDay = normalizeTimeOfDay(timeOfDay);
  const canSave =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    agentId.length > 0 &&
    normalizedTimeOfDay !== null;

  function handleSave() {
    if (!canSave || normalizedTimeOfDay === null) return;
    onSave({
      name: name.trim(),
      agent_id: agentId,
      prompt: prompt.trim(),
      schedule_kind: scheduleKind,
      time_of_day: normalizedTimeOfDay,
      day_of_week: scheduleKind === 'weekly' ? dayOfWeek : null,
    });
  }

  return (
    <KeyboardAvoidingView
      style={[s.formRoot, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.formHeader}>
        <TouchableOpacity onPress={onCancel} accessibilityRole="button">
          <Text style={s.formCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.formTitle}>Workflow</Text>
        <TouchableOpacity onPress={handleSave} accessibilityRole="button" disabled={!canSave}>
          <Text style={[s.formSave, !canSave && s.formSaveDisabled]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[s.formContent, { paddingBottom: insets.bottom + 120 }]}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.fieldLabel}>Name</Text>
        <TextInput
          style={s.textInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Morning Report"
          placeholderTextColor={brandColors.textMuted}
        />

        <Text style={s.fieldLabel}>Agent</Text>
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

        <Text style={s.fieldLabel}>Schedule</Text>
        <View style={s.segment}>
          {(['daily', 'weekly'] as WorkflowScheduleKind[]).map((kind) => (
            <TouchableOpacity
              key={kind}
              style={[s.segmentItem, scheduleKind === kind && s.segmentItemActive]}
              onPress={() => setScheduleKind(kind)}
              accessibilityRole="button"
            >
              <Text style={[s.segmentText, scheduleKind === kind && s.segmentTextActive]}>
                {kind.charAt(0).toUpperCase() + kind.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.fieldLabel}>Time</Text>
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
            <Text style={s.fieldLabel}>Weekday</Text>
            <View style={s.segment}>
              {WEEKDAYS.map((day) => (
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

        <Text style={s.fieldLabel}>Prompt</Text>
        <TextInput
          style={[s.textInput, s.textInputMultiline]}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="What should the agent do?"
          placeholderTextColor={brandColors.textMuted}
          multiline
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

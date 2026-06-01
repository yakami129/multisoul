import React, { useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

  const canSave = name.trim().length > 0 && prompt.trim().length > 0 && agentId.length > 0;

  function handleSave() {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      agent_id: agentId,
      prompt: prompt.trim(),
      schedule_kind: scheduleKind,
      time_of_day: timeOfDay,
      day_of_week: scheduleKind === 'weekly' ? dayOfWeek : null,
    });
  }

  return (
    <View style={[s.formRoot, { paddingTop: insets.top }]}>
      <View style={s.formHeader}>
        <TouchableOpacity onPress={onCancel} accessibilityRole="button">
          <Text style={s.formCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.formTitle}>Workflow</Text>
        <TouchableOpacity onPress={handleSave} accessibilityRole="button" disabled={!canSave}>
          <Text style={[s.formSave, !canSave && s.formSaveDisabled]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.formContent}>
        <Text style={s.fieldLabel}>Name</Text>
        <TextInput
          style={s.textInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Morning Report"
          placeholderTextColor="#555555"
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
            <View>
              <Text style={s.agentName}>{agent.name}</Text>
              <Text style={s.agentEndpoint}>{agent.endpoint_label}</Text>
            </View>
            {agentId === agent.id && (
              <Switch value disabled trackColor={{ false: '#333333', true: '#FF6B35' }} />
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
          placeholderTextColor="#555555"
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
          placeholderTextColor="#555555"
          multiline
        />
      </ScrollView>
    </View>
  );
}

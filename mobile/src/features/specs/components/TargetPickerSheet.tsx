import { Bot, Check, Server, X } from 'lucide-react-native';
import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { brandColors, brandRgba, brandTypography } from '@/theme/brandRefresh';
import { type Agent, type Endpoint } from '@/types';
import { type SpecTarget } from './specUiModels';

interface Props {
  visible: boolean;
  endpoints: Endpoint[];
  agents: Agent[];
  selectedTarget?: SpecTarget;
  presentation?: 'modal' | 'inline';
  onClose: () => void;
  onDone: (target: SpecTarget) => void;
}

export function TargetPickerSheet({
  visible,
  endpoints,
  agents,
  selectedTarget,
  presentation = 'modal',
  onClose,
  onDone,
}: Props) {
  const [query, setQuery] = React.useState('');
  const [endpointId, setEndpointId] = React.useState('');
  const [agentId, setAgentId] = React.useState(selectedTarget?.agentId ?? '');

  React.useEffect(() => {
    if (!visible) return;
    setEndpointId(selectedTarget?.endpointId ?? '');
    setAgentId(selectedTarget?.agentId ?? '');
    setQuery('');
  }, [selectedTarget, visible]);

  const filteredAgents = agents.filter((agent) => {
    if (endpointId && agent.endpoint_id !== endpointId) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${agent.name} ${agent.project_path}`.toLowerCase().includes(needle);
  });
  const selectedEndpoint = endpoints.find((endpoint) => endpoint.id === endpointId);
  const selectedAgent = agents.find(
    (agent) => agent.id === agentId && agent.endpoint_id === endpointId,
  );
  const canDone = Boolean(selectedEndpoint && selectedAgent);
  const agentEndpointIds = new Set(agents.map((agent) => agent.endpoint_id));

  const finish = () => {
    if (!selectedEndpoint || !selectedAgent || !canDone) return;
    onDone({
      endpointId: selectedEndpoint.id,
      endpointLabel: selectedEndpoint.label,
      agentId: selectedAgent.id,
      agentName: selectedAgent.name,
      repoPath: selectedAgent.project_path,
    });
  };

  const content = (
    <View style={s.root}>
      <View style={s.toolbar}>
        <TouchableOpacity accessibilityRole="button" onPress={onClose} style={s.toolbarButton}>
          <X size={18} color={brandColors.ink} />
          <Text style={s.toolbarText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.toolbarTitle}>Choose Target</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: !canDone }}
          disabled={!canDone}
          onPress={finish}
          style={[s.doneButton, !canDone && s.doneDisabled]}
        >
          <Text style={s.doneText}>Done</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <TextInput
          accessibilityLabel="Search agents"
          value={query}
          onChangeText={setQuery}
          placeholder="Search agents or repos"
          placeholderTextColor={brandColors.textMuted}
          style={s.search}
        />

        <View style={s.group}>
          <Text style={s.sectionTitle}>Endpoints</Text>
          {endpoints.map((endpoint) => {
            const offline = !endpoint.last_seen_at && !agentEndpointIds.has(endpoint.id);
            const selected = endpoint.id === endpointId;
            return (
              <TouchableOpacity
                key={endpoint.id}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: offline }}
                disabled={offline}
                onPress={() => {
                  setEndpointId(endpoint.id);
                  setAgentId('');
                }}
                style={[s.row, selected && s.rowSelected, offline && s.disabledRow]}
              >
                <Server size={17} color={offline ? brandColors.textMuted : brandColors.ink} />
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{endpoint.label}</Text>
                  <Text style={s.rowSubtitle}>
                    {offline
                      ? 'Offline. Reconnect before starting an interview.'
                      : endpoint.base_url}
                  </Text>
                </View>
                <View style={[s.checkSlot, selected && s.checkSlotSelected]}>
                  {selected ? <Check size={15} color={brandColors.ink} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.group}>
          <Text style={s.sectionTitle}>Agents</Text>
          {filteredAgents.length > 0 ? (
            filteredAgents.map((agent) => {
              const selected = agent.id === agentId;
              return (
                <TouchableOpacity
                  key={`${agent.endpoint_id}:${agent.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setEndpointId(agent.endpoint_id);
                    setAgentId(agent.id);
                  }}
                  style={[s.row, selected && s.rowSelected]}
                >
                  <Bot size={17} color={brandColors.ink} />
                  <View style={s.rowBody}>
                    <Text style={s.rowTitle}>{agent.name}</Text>
                    <Text style={s.rowSubtitle} numberOfLines={1}>
                      {agent.project_path}
                    </Text>
                  </View>
                  <View style={[s.checkSlot, selected && s.checkSlotSelected]}>
                    {selected ? <Check size={15} color={brandColors.ink} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>No agents for this target</Text>
              <Text style={s.emptyBody}>Open Agents to register a runner for this repo.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );

  if (presentation === 'inline') {
    if (!visible) return null;
    return <View style={s.inlineOverlay}>{content}</View>;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {content}
    </Modal>
  );
}

const s = StyleSheet.create({
  inlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
    backgroundColor: brandColors.cream,
  },
  root: { flex: 1, backgroundColor: brandColors.cream },
  toolbar: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: brandColors.silver,
  },
  toolbarButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolbarText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: brandColors.ink },
  toolbarTitle: {
    fontFamily: brandTypography.display,
    fontSize: 18,
    fontWeight: '700',
    color: brandColors.ink,
  },
  doneButton: {
    minHeight: 44,
    minWidth: 58,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandColors.ink,
  },
  doneDisabled: { opacity: 0.45 },
  doneText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '800', color: brandColors.white },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  search: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    paddingHorizontal: 14,
    fontFamily: 'Inter',
    fontSize: 14,
    color: brandColors.ink,
  },
  group: {
    borderRadius: 14,
    backgroundColor: brandRgba.white88,
    borderWidth: 1,
    borderColor: brandColors.silver,
    overflow: 'hidden',
  },
  sectionTitle: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '800',
    color: brandColors.textSoft,
    textTransform: 'uppercase',
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: brandColors.silver,
  },
  rowSelected: { backgroundColor: brandRgba.limeSoft },
  disabledRow: { opacity: 0.45 },
  checkSlot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSlotSelected: { backgroundColor: brandColors.lime },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: 'Inter', fontSize: 14, fontWeight: '800', color: brandColors.ink },
  rowSubtitle: { marginTop: 2, fontFamily: 'Inter', fontSize: 12, color: brandColors.textSoft },
  empty: { minHeight: 88, alignItems: 'center', justifyContent: 'center', padding: 14, gap: 4 },
  emptyTitle: { fontFamily: 'Inter', fontSize: 14, fontWeight: '800', color: brandColors.ink },
  emptyBody: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: brandColors.textSoft,
    textAlign: 'center',
  },
});

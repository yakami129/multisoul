import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, X } from 'lucide-react-native';
import React from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchAgent } from '@/features/agents';
import { fetchRuntimeModels, switchConversationModel } from '@/features/chat/services/chatService';
import { recordDiagnosticsEvent } from '@/services/diagnosticsLog';
import type { Conversation, Endpoint, RuntimeModel } from '@/types';

const MODEL_SWITCH_ACK_KEY = 'multisoul:model-switch-warning-seen';

export async function requestModelSwitchAcknowledgement(): Promise<{
  ok: boolean;
  alreadySeen: boolean;
}> {
  try {
    if ((await AsyncStorage.getItem(MODEL_SWITCH_ACK_KEY)) === '1') {
      return { ok: true, alreadySeen: true };
    }
  } catch (error: unknown) {
    recordDiagnosticsEvent('warn', 'chat.models', 'failed to read model switch acknowledgement', {
      error,
    });
  }
  return new Promise((resolve) => {
    Alert.alert(
      'Switch model?',
      'Chat history stays in place, the CLI resumes its existing history, and the new model applies to the next user message.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => resolve({ ok: false, alreadySeen: false }),
        },
        { text: 'Continue', onPress: () => resolve({ ok: true, alreadySeen: false }) },
      ],
    );
  });
}

export async function markModelSwitchAcknowledged(): Promise<void> {
  try {
    await AsyncStorage.setItem(MODEL_SWITCH_ACK_KEY, '1');
  } catch (error: unknown) {
    recordDiagnosticsEvent(
      'warn',
      'chat.models',
      'failed to persist model switch acknowledgement',
      {
        error,
      },
    );
  }
}

interface UseChatModelSelectorInput {
  endpoint: Endpoint | undefined;
  endpointId: string | undefined;
  convId: string;
  agentId?: string;
  agentName?: string;
  conversation: Conversation | undefined;
  isAwaitingResponse: boolean;
  addConversation?: (conversation: Conversation) => void;
  updateConversation: (id: string, patch: Partial<Conversation>) => void;
}

export function useChatModelSelector({
  endpoint,
  endpointId,
  convId,
  agentId,
  agentName,
  conversation,
  isAwaitingResponse,
  addConversation,
  updateConversation,
}: UseChatModelSelectorInput) {
  const [runtimeModels, setRuntimeModels] = React.useState<RuntimeModel[]>([]);
  const [visible, setVisible] = React.useState(false);
  const conversationStatus = conversation?.status ?? 'idle';
  const disabled =
    isAwaitingResponse ||
    conversationStatus === 'running' ||
    conversationStatus === 'awaiting_question';
  const selectedModel = runtimeModels.find((model) =>
    conversation?.model_id == null ? model.is_default : model.id === conversation.model_id,
  );
  const label =
    conversation?.model_id == null
      ? (selectedModel?.label ?? 'Default')
      : (selectedModel?.label ?? conversation?.model_id ?? 'Default');

  React.useEffect(() => {
    const agentIdForRuntime = conversation?.agent_id ?? agentId;
    if (!endpoint || !agentIdForRuntime) {
      setRuntimeModels([]);
      return undefined;
    }
    let cancelled = false;
    setRuntimeModels([]);
    fetchAgent(endpoint.base_url, endpoint.token, agentIdForRuntime, endpoint.id, endpoint.label)
      .then((agent) => fetchRuntimeModels(endpoint.base_url, endpoint.token, agent.runtime))
      .then((models) => {
        if (!cancelled) setRuntimeModels(models);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRuntimeModels([]);
        recordDiagnosticsEvent('warn', 'chat.models', 'failed to load runtime models', {
          conv_id: convId,
          endpoint_id: endpointId,
          agent_id: agentIdForRuntime,
          error,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, conversation?.agent_id, convId, endpoint, endpointId]);

  function open() {
    if (disabled) {
      Alert.alert(
        'Model switching unavailable',
        'The task is running. Switch models after stopping it or waiting for it to finish.',
      );
      return;
    }
    if (runtimeModels.length === 0) {
      Alert.alert('Model selector unavailable', 'Models are not available for this agent yet.');
      return;
    }
    setVisible(true);
  }

  async function select(modelId: string | null) {
    setVisible(false);
    if (!endpoint || modelId === conversation?.model_id || (!conversation && modelId == null)) {
      return;
    }
    const ack = await requestModelSwitchAcknowledgement();
    if (!ack.ok) return;
    try {
      const effectiveEndpointId = endpointId ?? conversation?.endpoint_id ?? '';
      const effectiveAgentName = conversation?.agent_name ?? agentName ?? '';
      const updated = await switchConversationModel(
        endpoint.base_url,
        endpoint.token,
        convId,
        effectiveEndpointId,
        effectiveAgentName,
        modelId,
      );
      if (conversation) updateConversation(convId, updated);
      else addConversation?.(updated);
      if (!ack.alreadySeen) void markModelSwitchAcknowledged();
    } catch (error: unknown) {
      recordDiagnosticsEvent('warn', 'chat.models', 'failed to switch model', {
        conv_id: convId,
        endpoint_id: endpointId,
        model_id: modelId,
        error,
      });
      Alert.alert(
        'Model switch failed',
        'Could not switch models. Try again after the task is idle.',
      );
    }
  }

  return {
    visible,
    setVisible,
    runtimeModels,
    currentModelLabel: label,
    modelSwitchDisabled: disabled,
    modelHeaderDisabled: disabled || runtimeModels.length === 0,
    open,
    select,
  };
}

interface Props {
  visible: boolean;
  models: RuntimeModel[];
  currentModelId: string | null;
  disabled: boolean;
  onClose: () => void;
  onSelect: (modelId: string | null) => void;
}

export function ModelSelector({
  visible,
  models,
  currentModelId,
  disabled,
  onClose,
  onSelect,
}: Props) {
  const currentId = currentModelId ?? models.find((model) => model.is_default)?.id ?? 'default';

  function handleSelect(model: RuntimeModel) {
    if (disabled || !model.available) return;
    onSelect(model.is_default ? null : model.id);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Model</Text>
            <Pressable testID="model-selector-close" style={s.closeButton} onPress={onClose}>
              <X size={18} color="#FFFFFF" />
            </Pressable>
          </View>
          {disabled ? <Text style={s.helper}>Available when idle</Text> : null}
          <View style={s.list}>
            {models.map((model) => {
              const selected = model.id === currentId;
              const rowDisabled = disabled || !model.available;
              return (
                <Pressable
                  key={model.id}
                  style={[
                    s.row,
                    selected ? s.rowSelected : null,
                    rowDisabled ? s.rowDisabled : null,
                  ]}
                  onPress={() => handleSelect(model)}
                >
                  <View style={s.rowCopy}>
                    <Text style={[s.label, rowDisabled ? s.labelDisabled : null]}>
                      {model.label}
                    </Text>
                    {!model.available ? <Text style={s.meta}>Unavailable</Text> : null}
                  </View>
                  {selected ? <Check size={18} color="#4CAF50" /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: 'Inter', fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#252525',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helper: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  list: { gap: 8 },
  row: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowSelected: { borderWidth: 1, borderColor: '#4CAF50', backgroundColor: '#1F2A1F' },
  rowDisabled: { opacity: 0.45 },
  rowCopy: { flex: 1 },
  label: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  labelDisabled: { color: '#666666' },
  meta: { marginTop: 2, fontFamily: 'Inter', fontSize: 12, color: '#888888' },
});

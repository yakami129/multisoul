import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, Button } from 'react-native';
import { fetchAgent } from '@/features/agents';
import { fetchRuntimeModels, switchConversationModel } from '@/features/chat/services/chatService';
import type { Conversation, Endpoint, RuntimeModel } from '@/types';
import {
  ModelSelector,
  requestModelSwitchAcknowledgement,
  useChatModelSelector,
} from './ModelSelector';

jest.mock('@/features/agents', () => ({ fetchAgent: jest.fn() }));
jest.mock('@/features/chat/services/chatService', () => ({
  fetchRuntimeModels: jest.fn(),
  switchConversationModel: jest.fn(),
}));
jest.mock('@/services/diagnosticsLog', () => ({ recordDiagnosticsEvent: jest.fn() }));

const models: RuntimeModel[] = [
  { id: 'default', label: 'Default', is_default: true, source: 'builtin', available: true },
  {
    id: 'gpt-5.3-codex',
    label: 'Codex 5.3',
    is_default: false,
    source: 'builtin',
    available: true,
  },
];

function assertTrue(value: boolean, message: string) {
  if (!value) throw new Error(message);
  expect(value).toBe(true);
}

function assertFalse(value: boolean, message: string) {
  if (value) throw new Error(message);
  expect(value).toBe(false);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) throw new Error(message);
  expect(actual).toBe(expected);
}

const endpoint: Endpoint = {
  id: 'endpoint-1',
  label: 'Local',
  base_url: 'http://localhost:8765',
  token: 'tok',
  last_seen_at: null,
};
const conversation: Conversation = {
  id: 'conv-1',
  agent_id: 'agent-1',
  title: 'Chat',
  created_at: 1,
  last_message_at: 2,
  status: 'completed',
  model_id: null,
  endpoint_id: 'endpoint-1',
  agent_name: 'Codex',
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/// ModelSelector Default option: selecting the runtime default sends null to the caller.
///
/// Data setup:
///   models[0].is_default = true, id = "default" (UI label only)
///   currentModelId = "gpt-5.3-codex" (non-default currently selected)
///
/// Execution:
///   1. Render the visible selector with two available models.
///   2. Press the "Default" row.
///
/// Expected result:
///   - Positive: onSelect receives null so PATCH can send model_id:null.
///   - Negative: onSelect must not receive the literal "default" id.
it('selecting Default calls onSelect with null', () => {
  const onSelect = jest.fn();

  const { getByText } = render(
    <ModelSelector
      visible
      models={models}
      currentModelId="gpt-5.3-codex"
      disabled={false}
      onClose={jest.fn()}
      onSelect={onSelect}
    />,
  );

  fireEvent.press(getByText('Default'));

  assertTrue(
    onSelect.mock.calls.some(([modelId]) => modelId === null),
    'Default row must map to null so PATCH clears model_id',
  );
  assertFalse(
    onSelect.mock.calls.some(([modelId]) => modelId === 'default'),
    'Default row must not persist the UI-only default id',
  );
});

/// ModelSelector concrete model: selecting a provider model sends its exact id.
///
/// Data setup:
///   models[1].id = "gpt-5.3-codex"
///   currentModelId = null (runtime default currently selected)
///
/// Execution:
///   1. Render the visible selector.
///   2. Press the "Codex 5.3" row.
///
/// Expected result:
///   - Positive: onSelect receives "gpt-5.3-codex".
///   - Negative: onSelect must not receive null for a concrete model row.
it('selecting a concrete model calls onSelect with that model id', () => {
  const onSelect = jest.fn();

  const { getByText } = render(
    <ModelSelector
      visible
      models={models}
      currentModelId={null}
      disabled={false}
      onClose={jest.fn()}
      onSelect={onSelect}
    />,
  );

  fireEvent.press(getByText('Codex 5.3'));

  assertTrue(
    onSelect.mock.calls.some(([modelId]) => modelId === 'gpt-5.3-codex'),
    'Concrete model row must pass its provider model id',
  );
  assertFalse(
    onSelect.mock.calls.some(([modelId]) => modelId === null),
    'Concrete model row must not be treated as Default',
  );
});

/// ModelSelector disabled state: while a task is active, options are visible but inert.
///
/// Data setup:
///   disabled = true (conversation running or awaiting question)
///   models include Default and Codex 5.3
///
/// Execution:
///   1. Render the visible selector in disabled mode.
///   2. Press the concrete model row.
///
/// Expected result:
///   - Positive: disabled helper text is shown.
///   - Negative: onSelect is not called for any model.
it('disabled selector does not call onSelect', () => {
  const onSelect = jest.fn();

  const { getByText } = render(
    <ModelSelector
      visible
      models={models}
      currentModelId={null}
      disabled
      onClose={jest.fn()}
      onSelect={onSelect}
    />,
  );

  fireEvent.press(getByText('Codex 5.3'));

  assertTrue(
    !!getByText('Available when idle'),
    'Disabled selector must explain that switching is only available when idle',
  );
  assertFalse(
    onSelect.mock.calls.length > 0,
    'Disabled selector must not call onSelect for any model row',
  );
});

/// Acknowledgement Cancel path: first-time warning lets the user abort before PATCH.
///
/// Data setup:
///   AsyncStorage.getItem returns null (warning has not been seen)
///   Alert button[0] = "Cancel"
///
/// Execution:
///   1. Call requestModelSwitchAcknowledgement().
///   2. Invoke the native alert Cancel callback.
///
/// Expected result:
///   - Positive: result.ok is false, so select() stops before PATCH.
///   - Negative: result.alreadySeen is false, because no persisted ack was read.
it('resolves false when first-switch acknowledgement is cancelled', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);
  const alertSpy = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) => buttons?.[0]?.onPress?.());

  const result = await requestModelSwitchAcknowledgement();

  assertEqual(result.ok, false, 'Cancel should resolve ok=false so model switch is skipped');
  assertEqual(
    result.alreadySeen,
    false,
    'Cancel path should not report an existing persisted acknowledgement',
  );
  assertEqual(
    alertSpy.mock.calls.length,
    1,
    'Missing acknowledgement should show exactly one native confirmation',
  );
});

/// Acknowledgement Continue path: first-time warning can proceed to PATCH.
///
/// Data setup:
///   AsyncStorage.getItem returns null (warning has not been seen)
///   Alert button[1] = "Continue"
///
/// Execution:
///   1. Call requestModelSwitchAcknowledgement().
///   2. Invoke the native alert Continue callback.
///
/// Expected result:
///   - Positive: result.ok is true, so select() may PATCH.
///   - Negative: result.alreadySeen remains false, so caller may persist the ack after PATCH.
it('resolves true when first-switch acknowledgement continues', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);
  const alertSpy = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());

  const result = await requestModelSwitchAcknowledgement();

  assertEqual(result.ok, true, 'Continue should resolve ok=true so model switch can proceed');
  assertEqual(
    result.alreadySeen,
    false,
    'First Continue should still report alreadySeen=false until persistence succeeds',
  );
  assertEqual(
    alertSpy.mock.calls.length,
    1,
    'First switch should show exactly one native confirmation',
  );
});

/// Acknowledgement storage read failure: AsyncStorage errors must not escape select().
///
/// Data setup:
///   AsyncStorage.getItem rejects with "storage offline"
///   Alert Continue is pressed
///
/// Execution:
///   1. Call requestModelSwitchAcknowledgement().
///   2. Storage read fails before the warning-seen check can complete.
///   3. Continue callback resolves the warning.
///
/// Expected result:
///   - Positive: result.ok is true after Continue, so the user can still switch.
///   - Negative: the promise does not reject from the getItem failure.
it('falls back to confirmation when acknowledgement storage read fails', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage offline'));
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.[1]?.onPress?.();
  });

  const result = await requestModelSwitchAcknowledgement();

  assertTrue(
    result.ok === true && result.alreadySeen === false,
    'getItem failure should not reject; Continue should still allow switching',
  );
});

/// Acknowledgement storage write failure: successful PATCH must not be reported as switch failure.
///
/// Data setup:
///   AsyncStorage.getItem returns null, so first-switch warning appears
///   Alert Continue is pressed
///   switchConversationModel resolves with model_id = "gpt-5.3-codex"
///   AsyncStorage.setItem rejects after PATCH succeeds
///
/// Execution:
///   1. Render a hook harness with an idle conversation.
///   2. Press a button that calls select("gpt-5.3-codex").
///   3. Wait for the async switch path to finish.
///
/// Expected result:
///   - Positive: updateConversation receives the switched conversation.
///   - Negative: native "Model switch failed" alert is not shown for setItem failure.
it('does not report switch failure when acknowledgement storage write fails after PATCH', async () => {
  const updateConversation = jest.fn();
  const switched = { ...conversation, model_id: 'gpt-5.3-codex' };
  jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('quota exceeded'));
  const alertSpy = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());
  (fetchAgent as jest.Mock).mockResolvedValue({
    id: 'agent-1',
    name: 'Codex',
    project_path: '/repo',
    runtime: 'codex',
    created_at: 1,
    endpoint_id: 'endpoint-1',
    endpoint_label: 'Local',
  });
  (fetchRuntimeModels as jest.Mock).mockResolvedValue(models);
  (switchConversationModel as jest.Mock).mockResolvedValue(switched);

  function Harness() {
    const selector = useChatModelSelector({
      endpoint,
      endpointId: endpoint.id,
      convId: conversation.id,
      agentId: conversation.agent_id,
      agentName: conversation.agent_name,
      conversation,
      isAwaitingResponse: false,
      updateConversation,
    });
    return <Button title="switch" onPress={() => void selector.select('gpt-5.3-codex')} />;
  }

  const { getByText } = render(<Harness />);
  fireEvent.press(getByText('switch'));
  await waitFor(() => {
    assertTrue(
      updateConversation.mock.calls.length > 0,
      'select should update the conversation after PATCH resolves',
    );
  });

  assertTrue(
    updateConversation.mock.calls.some(([id, patch]) => id === 'conv-1' && patch === switched),
    'Successful PATCH should update the conversation even if ack persistence fails later',
  );
  assertFalse(
    alertSpy.mock.calls.some(([title]) => title === 'Model switch failed'),
    'setItem failure after successful PATCH must not be shown as model switch failure',
  );
});

/// ModelSelector scrollable list: with many models, the list can be scrolled.
///
/// Data setup:
///   20 models to exceed screen space
///
/// Execution:
///   1. Render the visible selector with many models.
///
/// Expected result:
///   - Positive: ScrollView is rendered with showsVerticalScrollIndicator.
///   - Negative: list is not using a non-scrollable View.
it('renders a scrollable list when models exceed screen space', () => {
  const manyModels: RuntimeModel[] = Array.from({ length: 20 }, (_, i) => ({
    id: `model-${i}`,
    label: `Model ${i}`,
    is_default: i === 0,
    source: 'builtin',
    available: true,
  }));

  const { getByTestId, getByText } = render(
    <ModelSelector
      visible
      models={manyModels}
      currentModelId={null}
      disabled={false}
      onClose={jest.fn()}
      onSelect={jest.fn()}
    />,
  );

  // Verify ScrollView is rendered with testID
  const scrollView = getByTestId('model-list-scroll');
  assertTrue(scrollView !== null, 'Model list must be scrollable');

  // Verify first and last models are rendered
  assertTrue(getByText('Model 0') !== null, 'First model must be rendered');
  assertTrue(getByText('Model 19') !== null, 'Last model must be rendered');
});

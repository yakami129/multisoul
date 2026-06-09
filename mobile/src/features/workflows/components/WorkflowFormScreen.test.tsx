import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { type Agent, type Endpoint } from '@/types';
import { WorkflowFormScreen } from './WorkflowFormScreen';

let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

const endpoints: Endpoint[] = [
  {
    id: 'ep-1',
    label: 'Office Mac',
    base_url: 'http://office.local:8765',
    token: 'tok-office',
    last_seen_at: 10,
  },
  {
    id: 'ep-2',
    label: 'Travel Mac',
    base_url: 'http://travel.local:8765',
    token: 'tok-travel',
    last_seen_at: 10,
  },
];

const agents: Agent[] = [
  {
    id: 'agent-1',
    name: 'MultiSoul iOS',
    project_path: '/repo/multisoul',
    runtime: 'claude-code',
    created_at: 1_779_000_000_000,
    endpoint_id: 'ep-1',
    endpoint_label: 'Office Mac',
  },
  {
    id: 'agent-2',
    name: 'Backend Agent',
    project_path: '/repo/backend',
    runtime: 'codex',
    created_at: 1_779_000_000_000,
    endpoint_id: 'ep-1',
    endpoint_label: 'Office Mac',
  },
];

beforeEach(() => {
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
});

function renderForm(props: Partial<React.ComponentProps<typeof WorkflowFormScreen>> = {}) {
  return render(
    <WorkflowFormScreen
      agents={agents}
      endpoints={endpoints}
      onSave={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );
}

function selectAgent(screen: ReturnType<typeof render>, agentName = 'MultiSoul iOS') {
  fireEvent.press(screen.getByLabelText('Agent'));
  fireEvent.press(screen.getByText(agentName));
  fireEvent.press(screen.getByText('Done'));
}

test('save disabled when no agent selected on blank create', () => {
  const onSave = jest.fn();
  const screen = renderForm({ onSave });

  fireEvent.changeText(screen.getByPlaceholderText('e.g. CI Watch'), 'Test workflow');
  fireEvent.changeText(screen.getByPlaceholderText('What should the agent do?'), 'Do thing');
  fireEvent.press(screen.getByText('Save'));

  expect(onSave).not.toHaveBeenCalled();
});

test('sheet select agent then save succeeds', () => {
  const onSave = jest.fn();
  const screen = renderForm({ onSave });

  fireEvent.changeText(screen.getByPlaceholderText('e.g. CI Watch'), 'Morning report');
  fireEvent.changeText(screen.getByPlaceholderText('HH:MM'), '09:00');
  fireEvent.changeText(
    screen.getByPlaceholderText('What should the agent do?'),
    'Summarize repository',
  );
  selectAgent(screen, 'Backend Agent');
  fireEvent.press(screen.getByText('Save'));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      agent_id: 'agent-2',
      name: 'Morning report',
      prompt: 'Summarize repository',
    }),
  );
});

test('weekly segment shows weekday selector, daily hides it', () => {
  const screen = renderForm();

  expect(screen.queryByText('Weekday')).toBeNull();

  fireEvent.press(screen.getByText('Weekly'));
  expect(screen.getByText('Weekday')).toBeTruthy();

  fireEvent.press(screen.getByText('Daily'));
  expect(screen.queryByText('Weekday')).toBeNull();
});

test('empty prompt disables save', () => {
  const onSave = jest.fn();
  const screen = renderForm({ onSave });

  selectAgent(screen);
  fireEvent.press(screen.getByText('Save'));
  expect(onSave).not.toHaveBeenCalled();
});

test('save normalizes time before submitting workflow input', () => {
  const onSave = jest.fn();
  const screen = renderForm({ onSave });

  fireEvent.changeText(screen.getByPlaceholderText('e.g. CI Watch'), 'Morning report');
  fireEvent.changeText(screen.getByPlaceholderText('HH:MM'), '9:5');
  fireEvent.changeText(
    screen.getByPlaceholderText('What should the agent do?'),
    'Summarize repository',
  );
  selectAgent(screen);
  fireEvent.press(screen.getByText('Save'));

  expect({
    actual: onSave.mock.calls.length,
    reason: 'valid workflow form should call onSave once when Save is pressed',
  }).toEqual({ actual: 1, reason: expect.any(String) });
  expect({
    actual: onSave.mock.calls[0][0].time_of_day,
    reason: 'single-digit hour and minute should be padded before calling the API',
  }).toEqual({ actual: '09:05', reason: expect.any(String) });
  expect({
    actual: onSave.mock.calls[0][0].time_of_day,
    reason: 'raw 9:5 would be rejected by the CLI HH:mm validator and appear not to save',
  }).not.toEqual({ actual: '9:5', reason: expect.any(String) });
});

test('edit mode pre-fills workflow values before saving', () => {
  const onSave = jest.fn();
  const screen = renderForm({
    onSave,
    title: 'Edit Workflow',
    initialValues: {
      name: 'Friday Review',
      agent_id: 'agent-2',
      prompt: 'Review release risk',
      schedule_kind: 'weekly',
      time_of_day: '17:30',
      day_of_week: 5,
    },
  });

  expect(screen.getByText('Edit Workflow')).toBeTruthy();
  expect(screen.getByDisplayValue('Friday Review')).toBeTruthy();
  expect(screen.getByDisplayValue('Review release risk')).toBeTruthy();
  expect(screen.getByDisplayValue('17:30')).toBeTruthy();
  expect(screen.getByText('Weekday')).toBeTruthy();
  expect(screen.getByText('Backend Agent')).toBeTruthy();

  fireEvent.press(screen.getByText('Save'));

  expect({
    actual: onSave.mock.calls[0][0],
    reason: 'editing should submit the existing workflow fields unless the user changes them',
  }).toEqual({
    actual: {
      name: 'Friday Review',
      agent_id: 'agent-2',
      prompt: 'Review release risk',
      mode: 'recurring',
      schedule_kind: 'weekly',
      time_of_day: '17:30',
      day_of_week: 5,
    },
    reason: expect.any(String),
  });
  expect({
    actual: onSave.mock.calls[0][0].schedule_kind,
    reason: 'edit mode must not reset an existing weekly workflow to the default daily schedule',
  }).not.toEqual({ actual: 'daily', reason: expect.any(String) });
});

test('edit mode locks endpoint in picker', () => {
  const crossEndpointAgents: Agent[] = [
    ...agents,
    {
      id: 'agent-3',
      name: 'Remote Agent',
      project_path: '/repo/remote',
      runtime: 'codex',
      created_at: 1_779_000_000_000,
      endpoint_id: 'ep-2',
      endpoint_label: 'Travel Mac',
    },
  ];
  const screen = renderForm({
    agents: crossEndpointAgents,
    lockedEndpointId: 'ep-1',
    initialValues: {
      name: 'Locked workflow',
      agent_id: 'agent-1',
      prompt: 'Keep endpoint',
    },
  });

  fireEvent.press(screen.getByText('Change'));
  expect(screen.queryByText('Travel Mac')).toBeNull();
  expect(screen.queryByText('Remote Agent')).toBeNull();
});

test('form keeps time input reachable when the keyboard is open', () => {
  mockInsets = { top: 0, bottom: 20, left: 0, right: 0 };

  const { UNSAFE_getByType } = renderForm();

  const keyboardAvoider = UNSAFE_getByType(KeyboardAvoidingView);
  const scrollView = UNSAFE_getByType(ScrollView);
  const contentContainerStyle = scrollView.props.contentContainerStyle as Array<{
    paddingBottom?: number;
  }>;
  const bottomInsetStyle = contentContainerStyle[1];

  expect({
    actual: keyboardAvoider.props.behavior,
    reason: 'workflow form in an iOS pageSheet must move content above the keyboard',
  }).toEqual({ actual: 'padding', reason: expect.any(String) });
  expect({
    actual: scrollView.props.automaticallyAdjustKeyboardInsets,
    reason: 'ScrollView should resize its scrollable area when the keyboard appears',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: scrollView.props.keyboardShouldPersistTaps,
    reason: 'tapping the Time input while the keyboard is open should keep the tap handled',
  }).toEqual({ actual: 'handled', reason: expect.any(String) });
  expect({
    actual: bottomInsetStyle.paddingBottom,
    reason:
      'bottom padding should include safe area so the old 120pt spacer is not the only clearance',
  }).toEqual({ actual: 140, reason: expect.any(String) });
  expect({
    actual: bottomInsetStyle.paddingBottom,
    reason: 'the old fixed 120pt bottom padding would still let the keyboard cover lower fields',
  }).not.toEqual({ actual: 120, reason: expect.any(String) });
});

test('watch mode save includes selected agent', () => {
  const onSave = jest.fn();
  const screen = renderForm({ onSave, showModeSelector: true });

  fireEvent.press(screen.getByText('Watch'));
  fireEvent.changeText(screen.getByPlaceholderText('e.g. CI Watch'), 'CI Watch');
  fireEvent.changeText(screen.getByPlaceholderText('What should the agent do?'), 'Check CI status');
  selectAgent(screen);
  fireEvent.press(screen.getByText('Save'));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'watch',
      agent_id: 'agent-1',
    }),
  );
});

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type Agent, type Endpoint } from '@/types';
import { AgentTargetPickerSheet } from './AgentTargetPickerSheet';

const endpoints: Endpoint[] = [
  {
    id: 'ep-online',
    label: 'Office Mac',
    base_url: 'http://office.local:8765',
    token: 'tok-office',
    last_seen_at: 10,
  },
  {
    id: 'ep-offline',
    label: 'Travel Mac',
    base_url: 'http://travel.local:8765',
    token: 'tok-travel',
    last_seen_at: null,
  },
  {
    id: 'ep-empty',
    label: 'Spare Mac',
    base_url: 'http://spare.local:8765',
    token: 'tok-spare',
    last_seen_at: null,
  },
];

const agents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Codex Runner',
    project_path: '/repo/multisoul',
    runtime: 'codex',
    created_at: 1,
    endpoint_id: 'ep-online',
    endpoint_label: 'Office Mac',
  },
  {
    id: 'agent-2',
    name: 'Docs Runner',
    project_path: '/repo/docs',
    runtime: 'claude-code',
    created_at: 1,
    endpoint_id: 'ep-offline',
    endpoint_label: 'Travel Mac',
  },
];

test('keeps Done disabled until an agent is selected', () => {
  const onDone = jest.fn();
  const { getByText } = render(
    <AgentTargetPickerSheet
      visible
      endpoints={endpoints}
      agents={agents}
      onClose={() => {}}
      onDone={onDone}
    />,
  );

  expect(getByText('Offline. Reconnect before starting an interview.')).toBeTruthy();
  fireEvent.press(getByText('Done'));
  expect(onDone).not.toHaveBeenCalled();

  fireEvent.press(getByText('Codex Runner'));
  fireEvent.press(getByText('Done'));
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1' }));
});

test('shows all agents before endpoint filtering', () => {
  const { getByText } = render(
    <AgentTargetPickerSheet
      visible
      endpoints={endpoints}
      agents={agents}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

  expect(getByText('Codex Runner')).toBeTruthy();
  expect(getByText('Docs Runner')).toBeTruthy();
});

test('filters agents by search query and selected endpoint', () => {
  const { getByLabelText, getByText, queryByText } = render(
    <AgentTargetPickerSheet
      visible
      endpoints={endpoints}
      agents={agents}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

  expect(getByText('Codex Runner')).toBeTruthy();
  expect(getByText('Docs Runner')).toBeTruthy();

  fireEvent.press(getByText('Office Mac'));
  expect(queryByText('Docs Runner')).toBeNull();

  fireEvent.changeText(getByLabelText('Search agents'), 'docs');
  expect(queryByText('Codex Runner')).toBeNull();
  expect(getByText('No agents for this target')).toBeTruthy();
});

test('returns endpoint, agent, and repo target on Done', () => {
  const onDone = jest.fn();
  const { getByText } = render(
    <AgentTargetPickerSheet
      visible
      endpoints={endpoints}
      agents={agents}
      onClose={() => {}}
      onDone={onDone}
    />,
  );

  fireEvent.press(getByText('Codex Runner'));
  fireEvent.press(getByText('Done'));

  expect(onDone).toHaveBeenCalledWith(
    expect.objectContaining({
      endpointId: 'ep-online',
      endpointLabel: 'Office Mac',
      agentId: 'agent-1',
      agentName: 'Codex Runner',
      resourceId: 'agent-1',
      resourceName: 'Codex Runner',
      repoPath: '/repo/multisoul',
    }),
  );
});

test('lockedEndpointId shows only agents on that endpoint and endpoint is read-only', () => {
  const onDone = jest.fn();
  const { getByText, queryByText } = render(
    <AgentTargetPickerSheet
      visible
      endpoints={endpoints}
      agents={agents}
      lockedEndpointId="ep-online"
      onClose={() => {}}
      onDone={onDone}
    />,
  );

  expect(getByText('Office Mac')).toBeTruthy();
  expect(queryByText('Travel Mac')).toBeNull();
  expect(getByText('Codex Runner')).toBeTruthy();
  expect(queryByText('Docs Runner')).toBeNull();

  fireEvent.press(getByText('Codex Runner'));
  fireEvent.press(getByText('Done'));
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1' }));
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { AgentList } from './AgentList';
import { Agent } from '@/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const agents: Agent[] = [
  {
    id: 'a1',
    name: 'Alpha',
    project_path: '/repo/alpha',
    runtime: 'codex',
    created_at: 1,
    endpoint_id: 'ep-1',
    endpoint_label: 'Mac',
  },
  {
    id: 'a2',
    name: 'Beta',
    project_path: '/repo/beta',
    runtime: 'claude-code',
    created_at: 2,
    endpoint_id: 'ep-2',
    endpoint_label: 'Workstation',
  },
];

describe('AgentList', () => {
  it('renders list of agents', () => {
    const { getByText } = render(
      <AgentList agents={agents} isLoading={false} isError={false} error={null}
        isFetching={false} onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('ALPHA')).toBeTruthy();
    expect(getByText('BETA')).toBeTruthy();
  });

  it('shows loading text when isLoading', () => {
    const { getByText } = render(
      <AgentList agents={[]} isLoading isFetching={false} isError={false} error={null}
        onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('LOADING AGENTS...')).toBeTruthy();
  });

  it('shows error state when isError', () => {
    const { getByText } = render(
      <AgentList agents={[]} isLoading={false} isFetching={false} isError
        error={new Error('net fail')} onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('FAILED TO LOAD')).toBeTruthy();
  });

  it('calls onAgentPress with agent id', () => {
    const onAgentPress = jest.fn();
    const { getByText } = render(
      <AgentList agents={agents} isLoading={false} isError={false} error={null}
        isFetching={false} onRefetch={() => {}} onAgentPress={onAgentPress} />,
    );
    fireEvent.press(getByText('ALPHA'));
    expect(onAgentPress).toHaveBeenCalledWith('a1', 'ep-1');
  });

  it('does not show pull refresh spinner for background fetches', () => {
    const { UNSAFE_getByType } = render(
      <AgentList agents={agents} isLoading={false} isError={false} error={null}
        isFetching onRefetch={() => {}} onAgentPress={() => {}} />,
    );

    expect(UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });
});

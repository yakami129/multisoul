import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AgentList } from './AgentList';
import { Agent } from '@/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const agents: Agent[] = [
  { id: 'a1', name: 'Alpha', status: 'active', endpoint: 'http://a', description: '' },
  { id: 'a2', name: 'Beta', status: 'inactive', endpoint: 'http://b', description: 'desc' },
];

describe('AgentList', () => {
  it('renders list of agents', () => {
    const { getByText } = render(
      <AgentList agents={agents} isLoading={false} isError={false} error={null}
        isFetching={false} onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
  });

  it('shows loading text when isLoading', () => {
    const { getByText } = render(
      <AgentList agents={[]} isLoading isFetching={false} isError={false} error={null}
        onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('Loading agents...')).toBeTruthy();
  });

  it('shows error state when isError', () => {
    const { getByText } = render(
      <AgentList agents={[]} isLoading={false} isFetching={false} isError
        error={new Error('net fail')} onRefetch={() => {}} onAgentPress={() => {}} />,
    );
    expect(getByText('Failed to load agents.')).toBeTruthy();
  });

  it('calls onAgentPress with agent id', () => {
    const onAgentPress = jest.fn();
    const { getByText } = render(
      <AgentList agents={agents} isLoading={false} isError={false} error={null}
        isFetching={false} onRefetch={() => {}} onAgentPress={onAgentPress} />,
    );
    fireEvent.press(getByText('Alpha'));
    expect(onAgentPress).toHaveBeenCalledWith('a1');
  });
});

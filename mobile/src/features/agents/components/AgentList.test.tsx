import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { RefreshControl, ScrollView, TextInput } from 'react-native';
import { useChatStore } from '@/store/chatStore';
import { type Agent } from '@/types';
import { AgentList } from './AgentList';

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
  beforeEach(() => {
    useChatStore.setState({ conversations: [], messages: {} });
  });

  it('renders list of projects', () => {
    const { getByText, UNSAFE_getByType } = render(
      <AgentList
        agents={agents}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
    expect(getByText('Projects')).toBeTruthy();
    expect(UNSAFE_getByType(TextInput).props.placeholder).toBe('Search projects');
    expect(getByText('All Projects')).toBeTruthy();
  });

  it('shows loading text when isLoading', () => {
    const { getByText } = render(
      <AgentList
        agents={[]}
        isLoading
        isFetching={false}
        isError={false}
        error={null}
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );
    expect(getByText('Loading projects...')).toBeTruthy();
  });

  it('shows error state when isError', () => {
    const { getByText } = render(
      <AgentList
        agents={[]}
        isLoading={false}
        isFetching={false}
        isError
        error={new Error('net fail')}
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );
    expect(getByText('Failed to load')).toBeTruthy();
  });

  it('calls onAgentPress with project id, endpoint id, and name', () => {
    const onAgentPress = jest.fn();
    const { getByText } = render(
      <AgentList
        agents={agents}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={onAgentPress}
      />,
    );
    fireEvent.press(getByText('Alpha'));
    expect(onAgentPress).toHaveBeenCalledWith('a1', 'ep-1', 'Alpha');
  });

  it('does not show pull refresh spinner for background fetches', () => {
    const { UNSAFE_getByType } = render(
      <AgentList
        agents={agents}
        isLoading={false}
        isError={false}
        error={null}
        isFetching
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );

    expect(UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });

  it('filters projects through the search field', () => {
    const { UNSAFE_getByType, queryByText, getByText } = render(
      <AgentList
        agents={agents}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );

    fireEvent.changeText(UNSAFE_getByType(TextInput), 'beta');

    expect(getByText('Beta')).toBeTruthy();
    expect(queryByText('Alpha')).toBeNull();
  });

  /// Empty project list: the empty copy is fixed in place and cannot be dragged.
  ///
  /// Data construction:
  ///   agents = [] so ScrollView renders empty content only.
  ///
  /// Execution:
  ///   1. Render AgentList with no agents.
  ///   2. Read ScrollView scroll props.
  ///
  /// Expected:
  ///   - Positive: scrollEnabled=false fixes the empty state vertically.
  ///   - Negative: bounces=false prevents iOS rubber-band floating when the list has no content.
  it('disables scrolling and bounce when there are no agents', () => {
    const { UNSAFE_getByType } = render(
      <AgentList
        agents={[]}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );

    const scrollView = UNSAFE_getByType(ScrollView);

    expect(scrollView.props.scrollEnabled).toBe(false);
    expect(scrollView.props.bounces).toBe(false);
  });

  it('points empty state to adding a machine', () => {
    const { getByText } = render(
      <AgentList
        agents={[]}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );

    expect(getByText('Connect a machine')).toBeTruthy();
    expect(
      getByText('Add a machine by scanning its QR code or pasting a connection string.'),
    ).toBeTruthy();
  });

  it('shows running projects in Active Now', () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-1',
          agent_id: 'a1',
          title: 'Run checks',
          created_at: 1,
          last_message_at: 2,
          status: 'running',
          endpoint_id: 'ep-1',
          agent_name: 'Alpha',
        },
      ],
      messages: {},
    });

    const { getByText } = render(
      <AgentList
        agents={agents}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={() => {}}
      />,
    );

    expect(getByText('Active Now')).toBeTruthy();
    expect(getByText('Running · Codex')).toBeTruthy();
  });
});

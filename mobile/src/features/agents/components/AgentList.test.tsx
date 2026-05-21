import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
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
  it('renders list of projects', () => {
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
    expect(getByText('ALPHA')).toBeTruthy();
    expect(getByText('BETA')).toBeTruthy();
    expect(getByText('Projects')).toBeTruthy();
    expect(getByText('2 PROJECTS')).toBeTruthy();
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
    expect(getByText('FAILED TO LOAD')).toBeTruthy();
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
    fireEvent.press(getByText('ALPHA'));
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

  /// Agent cards spacing: adjacent cards are separated by a fixed vertical gap.
  ///
  /// Data construction:
  ///   agents = 2 records, enough to create exactly 1 inter-card separator.
  ///
  /// Execution:
  ///   1. Render AgentList with 2 agents.
  ///   2. Read FlatList.ItemSeparatorComponent and render it.
  ///   3. Flatten the separator style to inspect the concrete height.
  ///
  /// Expected:
  ///   - Positive: separator exists and height is 12, giving visible space between cards.
  ///   - Negative: separator height must not be 0, which would make cards visually stick together.
  it('adds visible spacing between agent cards', () => {
    const { UNSAFE_getByType } = render(
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

    const Separator = UNSAFE_getByType(FlatList).props.ItemSeparatorComponent;
    const separator = render(<Separator />).toJSON();
    const style = StyleSheet.flatten(separator?.props.style);

    expect(Separator).toBeTruthy();
    expect(style.height).toBe(12);
    expect(style.height).not.toBe(0);
  });

  /// Empty project list: the empty copy is fixed in place and cannot be dragged.
  ///
  /// Data construction:
  ///   agents = [] so FlatList renders ListEmptyComponent only.
  ///
  /// Execution:
  ///   1. Render AgentList with no agents.
  ///   2. Read FlatList scroll props.
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

    const flatList = UNSAFE_getByType(FlatList);

    expect(flatList.props.scrollEnabled).toBe(false);
    expect(flatList.props.bounces).toBe(false);
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
});

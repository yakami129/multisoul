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
  it('renders list of agents', () => {
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
    expect(getByText('LOADING AGENTS...')).toBeTruthy();
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

  it('calls onAgentPress with agent id, endpoint id, and name', () => {
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

  /// Workspace filter chips: selected and unselected workspace buttons have clear surfaces.
  ///
  /// Data construction:
  ///   agents = 2 records:
  ///     /repo/alpha -> workspace "alpha"
  ///     /repo/beta  -> workspace "beta"
  ///   default selected workspace = "all" from component state.
  ///
  /// Execution:
  ///   1. Render AgentList with 2 workspace names.
  ///   2. Read the "All" chip and the "alpha" chip styles in the unpressed state.
  ///   3. Flatten the Pressable style arrays returned by their style callbacks.
  ///
  /// Expected:
  ///   - Positive: selected "All" chip has orange background and pill radius.
  ///   - Positive: unselected "alpha" chip has a visible dark button background and pill radius.
  ///   - Negative: unselected "alpha" chip must not share the page background, or it will look borderless.
  it('styles workspace filter chips as rounded buttons with visible backgrounds', () => {
    const { getByTestId } = render(
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

    const selectedChip = getByTestId('workspace-chip-all');
    const alphaChip = getByTestId('workspace-chip-alpha');
    const selectedRawStyle =
      typeof selectedChip.props.style === 'function'
        ? selectedChip.props.style({ pressed: false })
        : selectedChip.props.style;
    const alphaRawStyle =
      typeof alphaChip.props.style === 'function'
        ? alphaChip.props.style({ pressed: false })
        : alphaChip.props.style;
    const selectedStyle = StyleSheet.flatten(selectedRawStyle);
    const alphaStyle = StyleSheet.flatten(alphaRawStyle);

    expect(selectedStyle.backgroundColor).toBe(
      '#FF6B35',
      'selected workspace chip should keep the documented action background',
    );
    expect(selectedStyle.borderRadius).toBe(
      18,
      'selected workspace chip should be a soft pill, not a sharp rectangle',
    );
    expect(alphaStyle.backgroundColor).toBe(
      '#252525',
      'unselected workspace chip should have a visible dark button surface',
    );
    expect(alphaStyle.backgroundColor).not.toBe(
      '#0D0D0D',
      'unselected workspace chip must not disappear into the page background',
    );
    expect(alphaStyle.borderRadius).toBe(
      18,
      'unselected workspace chip should use the same pill radius as the selected chip',
    );
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

  /// Empty agent list: the empty copy is fixed in place and cannot be dragged.
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
});

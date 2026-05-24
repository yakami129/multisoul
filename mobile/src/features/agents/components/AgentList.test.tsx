import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
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

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

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

  /// Projects add affordance: tapping the header plus delegates endpoint creation to the route.
  ///
  /// Data construction:
  ///   agents        = Alpha + Beta, so the Projects header renders in a normal loaded state.
  ///   onAddEndpoint = jest.fn callback owned by the route layer.
  ///
  /// Execution:
  ///   1. Render AgentList with onAddEndpoint.
  ///   2. Press the "Add endpoint" accessibility target in the header.
  ///
  /// Expected:
  ///   - Positive: onAddEndpoint is called once.
  ///   - Negative: onAgentPress is not called, because this is not a project row tap.
  it('calls onAddEndpoint when the Projects header plus is pressed', () => {
    const onAddEndpoint = jest.fn();
    const onAgentPress = jest.fn();
    const { getByLabelText } = render(
      <AgentList
        agents={agents}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={onAgentPress}
        onAddEndpoint={onAddEndpoint}
      />,
    );

    fireEvent.press(getByLabelText('Add endpoint'));

    expect(onAddEndpoint).toHaveBeenCalledTimes(1);
    expect(onAgentPress).not.toHaveBeenCalled();
  });

  /// Pencli Projects surface: root, search, and project group match the orange Projects mock.
  ///
  /// Data construction:
  ///   agents = 2 idle projects, so Active Now is absent and All Projects renders one group.
  ///   Target source = user-provided pencli Projects image:
  ///     root #0D0D0D, search/group #1A1A1A, search placeholder #666666
  ///     search radius 10, group radius 12
  ///
  /// Execution:
  ///   1. Render AgentList with two idle agents.
  ///   2. Read testID-marked structural containers and TextInput props.
  ///   3. Flatten RN style arrays to compare resolved values.
  ///
  /// Expected:
  ///   - Positive: orange pencli colors/radii are present on root, search, and group.
  ///   - Negative: the blue Pro Dark surface values (#000000/#1C1C1E/r=16/18) are not retained.
  it('matches the orange pencli Projects surface tokens', () => {
    const { getByTestId, UNSAFE_getByType } = render(
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

    const rootStyle = StyleSheet.flatten(getByTestId('projects-root').props.style);
    const searchStyle = StyleSheet.flatten(getByTestId('projects-search-box').props.style);
    const groupStyle = StyleSheet.flatten(getByTestId('projects-group').props.style);
    const searchInput = UNSAFE_getByType(TextInput);

    expectEqualWithReason(
      rootStyle.backgroundColor,
      '#0D0D0D',
      'Projects root should use the orange pencli near-black background',
    );
    expectEqualWithReason(
      searchStyle.backgroundColor,
      '#1A1A1A',
      'search field should use the orange pencli card surface',
    );
    expectEqualWithReason(
      searchStyle.borderRadius,
      10,
      'search field radius should match the user-provided pencli mock',
    );
    expectEqualWithReason(
      searchInput.props.placeholderTextColor,
      '#666666',
      'search placeholder should use the pencli disabled text gray',
    );
    expectEqualWithReason(
      groupStyle.backgroundColor,
      '#1A1A1A',
      'project list group should share the orange pencli card surface',
    );
    expectEqualWithReason(
      groupStyle.borderRadius,
      12,
      'project list group should use the user-provided pencli 12px card radius',
    );
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
    expect(getByText('Running')).toBeTruthy();
  });

  /// All Projects section: active projects are duplicated below Active Now.
  ///
  /// Data construction:
  ///   agents = Alpha + Beta.
  ///   conversations = one running conversation for Alpha, so Alpha is active.
  ///
  /// Execution:
  ///   1. Render AgentList.
  ///   2. Query all visible Alpha labels.
  ///
  /// Expected:
  ///   - Positive: Alpha appears once in Active Now and once in All Projects, matching the mock.
  ///   - Negative: All Projects is not reduced to idle-only projects.
  it('keeps active projects in the All Projects section', () => {
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

    const { getAllByText } = render(
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

    expect(getAllByText('Alpha').length).toBe(
      2,
      'active Alpha should appear in Active Now and remain in All Projects',
    );
  });

  /// Projects list width: Active Now rows and All Projects group share one horizontal frame.
  ///
  /// Data construction:
  ///   agents = Alpha + Beta.
  ///   conversations = one running conversation for Alpha, so Alpha renders in both sections.
  ///   Width target from the user screenshot:
  ///     content inset = 16px on both sides
  ///     card radius = 12px for the visual project frame
  ///
  /// Execution:
  ///   1. Render AgentList with Alpha active.
  ///   2. Find the Active Now frame by its #0D1A0D active background.
  ///   3. Read the All Projects group by testID.
  ///   4. Compare resolved RN styles for their outer frame geometry.
  ///
  /// Expected:
  ///   - Positive: Active Now uses the same 16px horizontal margin as All Projects.
  ///   - Positive: Active Now uses the same 12px radius as All Projects.
  ///   - Negative: Active Now must not remain full-bleed with no horizontal margin.
  it('aligns Active Now rows with the All Projects group width', () => {
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

    const { getByTestId, UNSAFE_getAllByType } = render(
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

    const activeFrame = UNSAFE_getAllByType(View).find((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.backgroundColor === '#0D1A0D';
    });
    expectEqualWithReason(
      activeFrame === undefined,
      false,
      'Active Now frame with #0D1A0D background should render for the running project',
    );

    const activeStyle = StyleSheet.flatten(activeFrame?.props.style);
    const groupStyle = StyleSheet.flatten(getByTestId('projects-group').props.style);

    expectEqualWithReason(
      activeStyle.marginHorizontal,
      16,
      'Active Now row should use the same 16px outer inset as All Projects',
    );
    expectEqualWithReason(
      activeStyle.borderRadius,
      groupStyle.borderRadius,
      'Active Now row should use the same visual frame radius as All Projects',
    );
    expectEqualWithReason(
      activeStyle.marginHorizontal === undefined,
      false,
      'Active Now row must not stay full-bleed without a horizontal margin',
    );
  });
});

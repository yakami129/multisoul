import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { RefreshControl, StyleSheet, TextInput } from 'react-native';
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

  it('renders the brand refresh agent fleet shell', () => {
    const { getByText, queryByText, UNSAFE_getByType } = render(
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

    expect(getByText('MultiSoul')).toBeTruthy();
    expect(getByText('Agents')).toBeTruthy();
    expect(getByText(/Your agents/)).toBeTruthy();
    expect(getByText('Agent Fleet')).toBeTruthy();
    expect(getByText('Quick Workflows')).toBeTruthy();
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
    expect(UNSAFE_getByType(TextInput).props.placeholder).toBe('Search agents...');
    expect(queryByText('All Agents')).toBeNull();
  });

  it('uses the cream prototype surface tokens', () => {
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

    expect(rootStyle.backgroundColor).toBe('#F6F3EC');
    expect(searchStyle.borderRadius).toBe(21);
    expect(searchStyle.borderColor).toBe('#E6E6E8');
    expect(searchInput.props.placeholderTextColor).toBe('#555555');
    expect(groupStyle.gap).toBe(6);
    expect(groupStyle.borderColor).toBeUndefined();
  });

  it('calls route callbacks for add endpoint and workflow shortcuts', () => {
    const onAddEndpoint = jest.fn();
    const onOpenWorkflows = jest.fn();
    const { getByLabelText, getByText } = render(
      <AgentList
        agents={agents}
        isLoading={false}
        isError={false}
        error={null}
        isFetching={false}
        onRefetch={() => {}}
        onAgentPress={() => {}}
        onAddEndpoint={onAddEndpoint}
        onOpenWorkflows={onOpenWorkflows}
      />,
    );

    fireEvent.press(getByLabelText('Add endpoint'));
    fireEvent.press(getByText('Connect Machine'));
    fireEvent.press(getByText('Daily Standup'));

    expect(onAddEndpoint).toHaveBeenCalledTimes(2);
    expect(onOpenWorkflows).toHaveBeenCalledTimes(1);
  });

  it('keeps workflow shortcut copy on a single line', () => {
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

    expect(getByText('Daily Standup').props.numberOfLines).toBe(1);
    expect(getByText('Connect Machine').props.numberOfLines).toBe(1);
    expect(getByText('Get updates from all agents and tasks.').props.numberOfLines).toBe(1);
    expect(getByText('Add a new machine and start commanding.').props.numberOfLines).toBe(1);
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

  it('filters projects by endpoint from the filter button', () => {
    const { getByLabelText, getByText, queryByText } = render(
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

    fireEvent.press(getByLabelText('Filter agents by endpoint'));
    expect(getByText('Filter by Machine')).toBeTruthy();
    expect(getByText('All Machines')).toBeTruthy();
    expect(getByText('Mac')).toBeTruthy();
    expect(getByText('Workstation')).toBeTruthy();

    fireEvent.press(getByLabelText('Workstation, 1 agent'));

    expect(getByText('Beta')).toBeTruthy();
    expect(queryByText('Alpha')).toBeNull();
    expect(getByText('Workstation · 1 agent')).toBeTruthy();
  });

  it('clears the endpoint filter back to the full fleet', () => {
    const { getByLabelText, getByText } = render(
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

    fireEvent.press(getByLabelText('Filter agents by endpoint'));
    fireEvent.press(getByLabelText('Workstation, 1 agent'));
    fireEvent.press(getByLabelText('Clear endpoint filter'));

    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
  });

  it('keeps running agents at the top of the fleet', () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-running',
          agent_id: 'a2',
          title: 'Running work',
          created_at: 1,
          last_message_at: 2,
          status: 'running',
          endpoint_id: 'ep-2',
          agent_name: 'Beta',
        },
      ],
      messages: {},
    });

    const { getAllByTestId } = render(
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

    expect(getAllByTestId('project-row')[0].props.accessibilityLabel).toBe('Open Beta');
  });

  it('shows loading and error states', () => {
    const loading = render(
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
    expect(loading.getByText('MultiSoul')).toBeTruthy();
    expect(loading.getByText(/Your agents/)).toBeTruthy();
    expect(loading.getByText('Agent Fleet')).toBeTruthy();
    expect(loading.getByText('Loading agents...')).toBeTruthy();
    expect(loading.getByText('Quick Workflows')).toBeTruthy();
    loading.unmount();

    const error = render(
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
    expect(error.getByText('Failed to load')).toBeTruthy();
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

  it('surfaces running and pending state in the fleet and hero stats', () => {
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
        {
          id: 'conv-2',
          agent_id: 'a2',
          title: 'Approve',
          created_at: 1,
          last_message_at: 2,
          status: 'awaiting_question',
          endpoint_id: 'ep-2',
          agent_name: 'Beta',
        },
      ],
      messages: {},
    });

    const { getAllByText, getByText } = render(
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

    expect(getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Needs Decision')).toBeTruthy();
    expect(getByText('Needs You')).toBeTruthy();
  });
});

import { render } from '@testing-library/react-native';
import React from 'react';
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

describe('AgentList running breathing effects', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], messages: {} });
  });

  /// Active Now breathing: only the Active Now copy of a running Agent gets life chrome.
  ///
  /// Data construction:
  ///   agents = Alpha + Beta.
  ///   conversations = one running conversation for Alpha.
  ///   Alpha renders twice: Active Now and All Agents.
  ///
  /// Execution:
  ///   1. Render AgentList with Alpha running.
  ///   2. Query running-agent-breath layers across the whole screen.
  ///   3. Query Alpha labels to confirm the duplicate All Agents row still exists.
  ///
  /// Expected:
  ///   - Positive: exactly one breathing effect renders for Alpha's Active Now row.
  ///   - Positive: Alpha still appears in All Agents.
  ///   - Negative: the duplicated All Agents row does not also render breathing chrome.
  it('renders breathing chrome only for the Active Now copy of a running agent', () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-running',
          agent_id: 'a1',
          agent_name: 'Alpha',
          endpoint_id: 'ep-1',
          title: 'Run task',
          status: 'running',
          created_at: 1000,
          last_message_at: 1000,
        },
      ],
      messages: {},
    });

    const { getAllByText, getAllByTestId } = render(
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

    expectEqualWithReason(
      getAllByTestId('running-agent-breath').length,
      1,
      'only the Active Now row should render rich breathing chrome for a running agent',
    );
    expectEqualWithReason(
      getAllByText('Alpha').length,
      2,
      'running agents should still appear in both Active Now and All Agents sections',
    );
    expectEqualWithReason(
      getAllByTestId('project-row').length,
      3,
      'list should still render Alpha twice and Beta once; the effect must not remove rows',
    );
  });

  /// Awaiting answer state: attention rows stay static even though they are active.
  ///
  /// Data construction:
  ///   conversations = one awaiting_question conversation for Alpha.
  ///   pendingCount  = 1.
  ///
  /// Execution:
  ///   1. Render AgentList with Alpha awaiting an answer.
  ///   2. Query pending badge and breathing chrome.
  ///
  /// Expected:
  ///   - Positive: awaiting answer status and pending badge remain visible.
  ///   - Negative: awaiting_question does not receive Running breathing chrome.
  it('does not render breathing chrome for awaiting-question active rows', () => {
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-question',
          agent_id: 'a1',
          agent_name: 'Alpha',
          endpoint_id: 'ep-1',
          title: 'Needs decision',
          status: 'awaiting_question',
          created_at: 1000,
          last_message_at: 1000,
        },
      ],
      messages: {},
    });

    const { getAllByText, getByText, queryByTestId } = render(
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

    expect(getByText('Running · Awaiting answer')).toBeTruthy();
    expectEqualWithReason(
      getAllByText('1').length >= 1,
      true,
      'awaiting-question active row should show a pending count badge',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath') === null,
      true,
      'awaiting-question rows should stay static and use the existing attention affordance',
    );
  });
});

import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { type Agent, type Conversation } from '@/types';
import { AgentDetail } from './AgentDetail';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children, renderRightActions }: any) => (
      <View>
        {children}
        {renderRightActions?.()}
      </View>
    ),
  };
});

const agent: Agent = {
  id: 'a1',
  name: 'My Agent',
  project_path: '/home/user/project',
  runtime: 'claude-code',
  created_at: 0,
  endpoint_id: 'ep-1',
  endpoint_label: 'Local',
};

const recentConversation: Conversation = {
  id: 'conv-1',
  agent_id: 'a1',
  title: 'New Chat',
  created_at: 1,
  last_message_at: 2,
  status: 'running',
  endpoint_id: 'ep-1',
  agent_name: 'My Agent',
  first_user_message: 'Add a dark mode toggle',
  last_ai_reply: 'The dark mode toggle is wired up',
};

describe('AgentDetail', () => {
  it('renders loading indicator when isLoading', () => {
    const { getByText } = render(
      <AgentDetail
        agent={undefined}
        isLoading
        isError={false}
        onBack={() => {}}
        onNewChat={() => {}}
      />,
    );
    expect(getByText('Loading...')).toBeTruthy();
  });

  it('renders project details and recent chats', () => {
    const { getByText, getAllByText, queryByText } = render(
      <AgentDetail
        agent={agent}
        recentConversations={[recentConversation]}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewChat={() => {}}
      />,
    );
    expect(getByText('My Agent')).toBeTruthy();
    expect(getAllByText('Resource running on Local · Claude Code').length).toBeGreaterThanOrEqual(
      1,
    );
    expect(getByText('Recent Sessions')).toBeTruthy();
    expect(getByText('Add a dark mode toggle')).toBeTruthy();
    expect(getByText('The dark mode toggle is wired up')).toBeTruthy();
    expect(queryByText('INVOKE')).toBeNull();
  });

  /// Agent hero workspace path: the detail header exposes the full project path.
  ///
  /// Data construction:
  ///   agent.name         = "My Agent"
  ///   agent.project_path = "/home/user/project"
  ///   status label       = derived from running conversation + endpoint/runtime
  ///
  /// Execution process:
  ///   1. Render AgentDetail with one running recent conversation.
  ///   2. Read the hero text nodes above the New Chat button.
  ///
  /// Expected result:
  ///   - Positive: the exact full workspace path is visible.
  ///   - Negative: the path is not collapsed to only the final workspace name.
  it('renders the full workspace path in the project hero', () => {
    const { getByText, queryByText } = render(
      <AgentDetail
        agent={agent}
        recentConversations={[recentConversation]}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewChat={() => {}}
      />,
    );

    expect(getByText('/home/user/project')).toBeTruthy();
    expect(queryByText('project')).toBeNull();
  });

  it('calls onBack when GO BACK pressed in error state', () => {
    const onBack = jest.fn();
    const { getByText } = render(
      <AgentDetail
        agent={undefined}
        isLoading={false}
        isError
        onBack={onBack}
        onNewChat={() => {}}
      />,
    );
    fireEvent.press(getByText('Go back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls onNewChat when New Chat is pressed', () => {
    const onNewChat = jest.fn();
    const { getByText } = render(
      <AgentDetail
        agent={agent}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewChat={onNewChat}
      />,
    );
    fireEvent.press(getByText('New Session'));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('opens a recent conversation when pressed', () => {
    const onOpenConversation = jest.fn();
    const onDeleteConversation = jest.fn();
    const { getByText } = render(
      <AgentDetail
        agent={agent}
        recentConversations={[recentConversation]}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewChat={() => {}}
        onOpenConversation={onOpenConversation}
        onDeleteConversation={onDeleteConversation}
      />,
    );

    fireEvent.press(getByText('Add a dark mode toggle'));
    expect(onOpenConversation).toHaveBeenCalledWith(recentConversation);
    expect(onDeleteConversation).not.toHaveBeenCalled();
  });

  /// Recent chat swipe action: every Project Detail chat row exposes a DELETE affordance.
  ///
  /// Data construction:
  ///   recentConversations = [recentConversation]
  ///   mocked Swipeable    = immediately renders renderRightActions()
  ///
  /// Execution process:
  ///   1. Render AgentDetail with one recent conversation.
  ///   2. Read all visible DELETE labels from the mocked swipe action area.
  ///
  /// Expected result:
  ///   - Positive: one DELETE action is visible for the single recent chat.
  ///   - Negative: the empty Recent Chats state is not visible while a row exists.
  it('renders a DELETE swipe action for a recent conversation', () => {
    const { getAllByText, queryByText } = render(
      <AgentDetail
        agent={agent}
        recentConversations={[recentConversation]}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewChat={() => {}}
      />,
    );

    expect(getAllByText('DELETE')).toHaveLength(1);
    expect(queryByText('No recent sessions yet.')).toBeNull();
  });

  /// Recent chat deletion: tapping the revealed DELETE action reports the exact conversation.
  ///
  /// Data construction:
  ///   conversation id = conv-1
  ///   onDeleteConversation = jest spy
  ///
  /// Execution process:
  ///   1. Render one recent conversation.
  ///   2. Press DELETE from the mocked Swipeable right action.
  ///
  /// Expected result:
  ///   - Positive: onDeleteConversation receives recentConversation.
  ///   - Negative: onOpenConversation is not called by the delete action.
  it('calls onDeleteConversation with the matching recent conversation', () => {
    const onDeleteConversation = jest.fn();
    const onOpenConversation = jest.fn();
    const { getByText } = render(
      <AgentDetail
        agent={agent}
        recentConversations={[recentConversation]}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onNewChat={() => {}}
        onOpenConversation={onOpenConversation}
        onDeleteConversation={onDeleteConversation}
      />,
    );

    fireEvent.press(getByText('DELETE'));

    expect(onDeleteConversation).toHaveBeenCalledWith(recentConversation);
    expect(onOpenConversation).not.toHaveBeenCalled();
  });
});

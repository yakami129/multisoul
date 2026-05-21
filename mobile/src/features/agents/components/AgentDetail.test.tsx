import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { type Agent, type Conversation } from '@/types';
import { AgentDetail } from './AgentDetail';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

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
  title: 'Add dark mode toggle',
  created_at: 1,
  last_message_at: 2,
  status: 'running',
  endpoint_id: 'ep-1',
  agent_name: 'My Agent',
  first_user_message: 'Add a dark mode toggle',
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
    // Loading state shows LOADING… text
    expect(getByText('LOADING...')).toBeTruthy();
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
    expect(getByText('MY AGENT')).toBeTruthy();
    expect(getByText('Local')).toBeTruthy();
    expect(getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Recent Chats')).toBeTruthy();
    expect(getByText('Add dark mode toggle')).toBeTruthy();
    expect(queryByText('INVOKE')).toBeNull();
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
    fireEvent.press(getByText('GO BACK'));
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
    fireEvent.press(getByText('New Chat'));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('opens a recent conversation when pressed', () => {
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
      />,
    );

    fireEvent.press(getByText('Add dark mode toggle'));
    expect(onOpenConversation).toHaveBeenCalledWith(recentConversation);
  });
});

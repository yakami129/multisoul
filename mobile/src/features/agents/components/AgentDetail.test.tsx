import { render, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { type Agent } from '@/types';
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

describe('AgentDetail', () => {
  it('renders loading indicator when isLoading', () => {
    const { getByText } = render(
      <AgentDetail
        agent={undefined}
        isLoading
        isError={false}
        onBack={() => {}}
        onInvoke={async () => 'ok'}
        onChat={() => {}}
      />,
    );
    // Loading state shows LOADING… text
    expect(getByText('LOADING…')).toBeTruthy();
  });

  it('renders agent details', () => {
    const { getByText } = render(
      <AgentDetail
        agent={agent}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onInvoke={async () => 'ok'}
        onChat={() => {}}
      />,
    );
    // Agent name is rendered uppercased
    expect(getByText('MY AGENT')).toBeTruthy();
    // Endpoint label is shown in the ENDPOINT row
    expect(getByText('Local')).toBeTruthy();
  });

  it('calls onBack when GO BACK pressed in error state', () => {
    const onBack = jest.fn();
    const { getByText } = render(
      <AgentDetail
        agent={undefined}
        isLoading={false}
        isError
        onBack={onBack}
        onInvoke={async () => 'ok'}
        onChat={() => {}}
      />,
    );
    fireEvent.press(getByText('GO BACK'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows modal with result after invoke', async () => {
    const { getByText, getAllByText, getByPlaceholderText } = render(
      <AgentDetail
        agent={agent}
        isLoading={false}
        isError={false}
        onBack={() => {}}
        onInvoke={async () => 'conv-123'}
        onChat={() => {}}
      />,
    );
    fireEvent.changeText(getByPlaceholderText('Enter a task for the agent…'), 'hello');
    // Both the section title and the button have text 'INVOKE'; press the last one (the button)
    const invokeElements = getAllByText('INVOKE');
    fireEvent.press(invokeElements[invokeElements.length - 1]);
    await waitFor(() => expect(getByText('Conversation started: conv-123')).toBeTruthy());
  });
});

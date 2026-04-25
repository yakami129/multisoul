import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AgentDetail } from './AgentDetail';
import { Agent } from '@/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const agent: Agent = {
  id: 'a1',
  name: 'My Agent',
  status: 'active',
  endpoint: 'http://localhost:9000',
  description: 'A test agent',
};

describe('AgentDetail', () => {
  it('renders loading indicator when isLoading', () => {
    const { getByTestId } = render(
      <AgentDetail agent={undefined} isLoading isError={false} onBack={() => {}} onInvoke={async () => 'ok'} />,
    );
    expect(getByTestId('loading-indicator')).toBeTruthy();
  });

  it('renders agent details', () => {
    const { getByText } = render(
      <AgentDetail agent={agent} isLoading={false} isError={false} onBack={() => {}} onInvoke={async () => 'ok'} />,
    );
    expect(getByText('My Agent')).toBeTruthy();
    expect(getByText('http://localhost:9000')).toBeTruthy();
  });

  it('calls onBack when Back pressed', () => {
    const onBack = jest.fn();
    const { getByText } = render(
      <AgentDetail agent={agent} isLoading={false} isError={false} onBack={onBack} onInvoke={async () => 'ok'} />,
    );
    fireEvent.press(getByText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows modal with result after invoke', async () => {
    const { getByText } = render(
      <AgentDetail agent={agent} isLoading={false} isError={false} onBack={() => {}}
        onInvoke={async () => 'invoke result'} />,
    );
    fireEvent.press(getByText('Invoke'));
    await waitFor(() => expect(getByText('invoke result')).toBeTruthy());
  });
});

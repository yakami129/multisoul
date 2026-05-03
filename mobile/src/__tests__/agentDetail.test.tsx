import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentDetailScreen from '../../app/agent/[id]/index';
import { useEndpointStore } from '../store/endpointStore';

const mockPush = jest.fn();

jest.mock('../features/agents/services/agentService', () => ({
  fetchAgent: jest.fn(),
  invokeAgent: jest.fn(),
}));

jest.mock('../features/chat/services/chatService', () => ({
  createConversation: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'uuid-1', endpoint_id: 'ep-1' }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const mockAgent = {
  id: 'uuid-1',
  name: 'Weather Agent',
  project_path: '/home/user/weather',
  runtime: 'claude-code' as const,
  created_at: 0,
  endpoint_id: 'ep-1',
  endpoint_label: 'Local',
};

/// Agent detail screen: loads agent via fetchAgent and renders details
///
/// Data:
///   fetchAgent → mockAgent
///
/// Execution:
///   1. Seed endpointStore with ep-1
///   2. Render AgentDetailScreen (useLocalSearchParams returns id=uuid-1, endpoint_id=ep-1)
///   3. fetchAgent resolves with mockAgent
///   4. Wait for agent name to appear
///
/// Expected:
///   - 'WEATHER AGENT' visible after load
///   - 'Local' endpoint label visible
describe('AgentDetailScreen', () => {
  const { fetchAgent } = require('../features/agents/services/agentService');
  const { createConversation } = require('../features/chat/services/chatService');

  beforeEach(() => {
    mockPush.mockClear();
    useEndpointStore.setState({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Local',
          base_url: 'http://localhost:8765',
          token: 'tok',
          last_seen_at: null,
        },
      ],
    });
    fetchAgent.mockResolvedValue(mockAgent);
    createConversation.mockResolvedValue({
      id: 'conv-123',
      agent_id: 'uuid-1',
      title: 'New Chat',
      created_at: 1,
      last_message_at: 1,
      status: 'idle',
    });
  });

  afterEach(() => {
    act(() => {
      useEndpointStore.setState({ endpoints: [] });
    });
    fetchAgent.mockReset();
    createConversation.mockReset();
  });

  it('renders agent details', async () => {
    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('WEATHER AGENT')).toBeTruthy();
    });

    expect(screen.getByText('Local')).toBeTruthy();
  });

  it('shows error state when fetchAgent fails', async () => {
    fetchAgent.mockRejectedValue(new Error('network error'));

    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('FAILED TO LOAD')).toBeTruthy();
    });
  });

  it('opens the canonical chat detail screen from OPEN CHAT', async () => {
    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('WEATHER AGENT')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('OPEN CHAT'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/chat/conv-123?endpoint_id=ep-1&agent_id=uuid-1&agent_name=Weather%20Agent',
      ),
    );
  });
});

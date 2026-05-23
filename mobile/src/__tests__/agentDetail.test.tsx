import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentDetailScreen from '../../app/agent/[id]/index';
import { useEndpointStore } from '../store/endpointStore';

const mockPush = jest.fn();

jest.mock('../features/agents/services/agentService', () => ({
  fetchAgent: jest.fn(),
}));

jest.mock('../features/chat/services/chatService', () => ({
  createConversation: jest.fn(),
  fetchConversations: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'uuid-1', endpoint_id: 'ep-1' }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => (() => void) | void) => {
    // In tests, run the focus effect once on mount (simulating screen focus).
    const { useEffect } = require('react');
    useEffect(() => cb(), []); // eslint-disable-line react-hooks/exhaustive-deps -- jest mock: stable one-shot focus
  },
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
///   - 'Weather Agent' visible after load
///   - endpoint status pill visible
describe('AgentDetailScreen', () => {
  const { fetchAgent } = require('../features/agents/services/agentService');
  const {
    createConversation,
    fetchConversations,
  } = require('../features/chat/services/chatService');

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
    fetchConversations.mockResolvedValue([
      {
        id: 'conv-existing',
        agent_id: 'uuid-1',
        title: 'New Chat',
        created_at: 1,
        last_message_at: 2,
        status: 'running',
        endpoint_id: 'ep-1',
        agent_name: 'Weather Agent',
        first_user_message: 'Look for severe weather warnings',
        last_ai_reply: 'There are no severe warnings right now',
      },
    ]);
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
    fetchConversations.mockReset();
    createConversation.mockReset();
  });

  it('renders agent details', async () => {
    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    expect(screen.getByText('Running on Local · Claude Code')).toBeTruthy();
    expect(screen.getByText('Recent Chats')).toBeTruthy();
    expect(screen.getByText('Look for severe weather warnings')).toBeTruthy();
    expect(screen.getByText('There are no severe warnings right now')).toBeTruthy();
  });

  it('shows error state when fetchAgent fails', async () => {
    fetchAgent.mockRejectedValue(new Error('network error'));

    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeTruthy();
    });
  });

  it('still shows Project Detail when recent chats fail to load', async () => {
    fetchConversations.mockRejectedValue(new Error('recent chats failed'));

    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    expect(screen.getByText('No recent chats yet.')).toBeTruthy();
  });

  it('opens the canonical chat detail screen from New Chat', async () => {
    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('New Chat'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/chat/conv-123?endpoint_id=ep-1&agent_id=uuid-1&agent_name=Weather%20Agent',
      ),
    );
  });

  it('opens a recent chat from Project Detail', async () => {
    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Look for severe weather warnings')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Look for severe weather warnings'));

    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-existing?endpoint_id=ep-1&agent_id=uuid-1&agent_name=Weather%20Agent',
    );
  });
});

import { act, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentDetailScreen from '../../app/agent/[id]/index';
import { useEndpointStore } from '../store/endpointStore';

jest.mock('../features/agents/services/agentService', () => ({
  fetchAgent: jest.fn(),
  invokeAgent: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'uuid-1', endpoint_id: 'ep-1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
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

  beforeEach(() => {
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
  });

  afterEach(() => {
    act(() => {
      useEndpointStore.setState({ endpoints: [] });
    });
    fetchAgent.mockReset();
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
});

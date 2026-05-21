import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentListScreen from '../../app/(tabs)/index';
import { useEndpointStore } from '../../src/store/endpointStore';
import { type Agent } from '../types';

jest.mock('../../src/features/agents/services/agentService', () => ({
  fetchAllAgents: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  Link: ({ children }: any) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const mockAgents: Agent[] = [
  {
    id: 'uuid-1',
    name: 'Weather Agent',
    project_path: '/home/user/weather',
    runtime: 'claude-code',
    created_at: 0,
    endpoint_id: 'ep-1',
    endpoint_label: 'Local',
  },
  {
    id: 'uuid-2',
    name: 'Broken Agent',
    project_path: '/home/user/broken',
    runtime: 'codex',
    created_at: 0,
    endpoint_id: 'ep-1',
    endpoint_label: 'Local',
  },
  {
    id: 'uuid-3',
    name: 'Idle Agent',
    project_path: '/home/user/idle',
    runtime: 'custom',
    created_at: 0,
    endpoint_id: 'ep-1',
    endpoint_label: 'Local',
  },
];

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/// Project list: renders projects returned by fetchAllAgents
///
/// Data: 3 agents with different runtimes
///
/// Execution:
///   1. Seed endpointStore with one endpoint so query is enabled
///   2. Mock fetchAllAgents to resolve with mockAgents
///   3. Render AgentListScreen inside QueryClientProvider
///   4. Wait for data to load
///
/// Expected:
///   - All three project names visible (uppercased)
describe('AgentListScreen', () => {
  const { fetchAllAgents } = require('../../src/features/agents/services/agentService');

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    // Seed the endpoint store so the query is enabled
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
    fetchAllAgents.mockResolvedValue(mockAgents);
  });

  afterEach(() => {
    queryClient.clear();
    act(() => {
      useEndpointStore.setState({ endpoints: [] });
    });
    fetchAllAgents.mockReset();
  });

  it('renders project list with runtime badges', async () => {
    render(<AgentListScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('WEATHER AGENT')).toBeTruthy();
    });

    expect(screen.getByText('BROKEN AGENT')).toBeTruthy();
    expect(screen.getByText('IDLE AGENT')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    fetchAllAgents.mockImplementation(() => new Promise(() => {}));

    render(<AgentListScreen />, { wrapper });
    expect(screen.getByText('Loading projects...')).toBeTruthy();
  });

  it('shows empty state when no projects', async () => {
    fetchAllAgents.mockResolvedValue([]);

    render(<AgentListScreen />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Connect a machine')).toBeTruthy();
    });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentListScreen from '../../app/(tabs)/index';
import { useEndpointStore } from '../../src/store/endpointStore';
import { type Agent } from '../types';

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}));

jest.mock('../../src/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({
    get: jest.fn(),
  })),
  clearEndpointClients: jest.fn(),
}));

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
  SafeAreaView: ({ children }: any) => children,
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
///   - All three agent names visible with their source casing
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
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    expect(screen.getByText('Broken Agent')).toBeTruthy();
    expect(screen.getByText('Idle Agent')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    fetchAllAgents.mockImplementation(() => new Promise(() => {}));

    render(<AgentListScreen />, { wrapper });
    expect(screen.getByText('Loading agents...')).toBeTruthy();
  });

  it('shows empty state when no projects', async () => {
    fetchAllAgents.mockResolvedValue([]);

    render(<AgentListScreen />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Connect a machine')).toBeTruthy();
    });
  });

  /// Agents route add endpoint: header plus opens Add Endpoint directly on QR mode.
  ///
  /// Data construction:
  ///   endpointStore = one configured endpoint, so Agents route renders loaded list state.
  ///   fetchAllAgents = mockAgents, so the header plus is available above project rows.
  ///   camera permission = false, so QR mode displays the permission CTA.
  ///
  /// Execution:
  ///   1. Render AgentListScreen inside QueryClientProvider.
  ///   2. Wait for project data.
  ///   3. Press the "Add endpoint" header button.
  ///
  /// Expected:
  ///   - Positive: full-screen Add Endpoint copy is visible.
  ///   - Positive: QR mode is active via "TAP TO ALLOW CAMERA".
  ///   - Negative: legacy centered-card "ADD ENDPOINT" heading is not shown.
  it('opens the add endpoint modal in QR mode from the Agents header plus', async () => {
    render(<AgentListScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Add endpoint'));

    expect(screen.getByText('Connect a machine')).toBeTruthy();
    expect(screen.getByText('TAP TO ALLOW CAMERA')).toBeTruthy();
    expect(screen.queryByText('ADD ENDPOINT')).toBeNull();
  });
});

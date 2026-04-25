import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentListScreen from '../../app/(tabs)/index';
import { Agent } from '../types';

jest.mock('../../src/api', () => ({
  getApiClient: jest.fn(),
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
    description: 'Fetches weather data',
    endpoint: 'http://weather.local/invoke',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'uuid-2',
    name: 'Broken Agent',
    description: 'Always fails',
    endpoint: 'http://broken.local/invoke',
    status: 'error',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'uuid-3',
    name: 'Idle Agent',
    description: 'Not running',
    endpoint: 'http://idle.local/invoke',
    status: 'inactive',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/// Agent list: renders agents with correct status badge colors
///
/// Data: 3 agents — active, error, inactive
///
/// Execution:
///   1. Mock getApiClient returns axios instance (sync) that resolves agents list
///   2. Render AgentListScreen inside QueryClientProvider
///   3. Wait for data to load
///
/// Expected:
///   - 'Weather Agent' visible (active)
///   - 'Broken Agent' visible (error)
///   - 'Idle Agent' visible (inactive)
describe('AgentListScreen', () => {
  beforeEach(() => {
    const { getApiClient } = require('../../src/api');
    getApiClient.mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: mockAgents }),
    });
  });

  it('renders agent list with status badges', async () => {
    render(<AgentListScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    expect(screen.getByText('Broken Agent')).toBeTruthy();
    expect(screen.getByText('Idle Agent')).toBeTruthy();

    expect(screen.getByText('active')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('inactive')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    const { getApiClient } = require('../../src/api');
    getApiClient.mockReturnValue({
      get: jest.fn().mockImplementation(() => new Promise(() => {})),
    });

    render(<AgentListScreen />, { wrapper });
    expect(screen.getByText('Loading agents...')).toBeTruthy();
  });

  it('shows empty state when no agents', async () => {
    const { getApiClient } = require('../../src/api');
    getApiClient.mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: [] }),
    });

    render(<AgentListScreen />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('No agents registered yet.')).toBeTruthy();
    });
  });
});

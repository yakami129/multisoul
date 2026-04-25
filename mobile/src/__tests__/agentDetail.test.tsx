import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentDetailScreen from '../../app/agent/[id]';

jest.mock('../../src/api', () => ({
  getApiClient: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'uuid-1' }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const mockAgent = {
  id: 'uuid-1',
  name: 'Weather Agent',
  description: 'Fetches weather data',
  endpoint: 'http://weather.local/invoke',
  status: 'active',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/// Agent detail: shows agent info and invoke button; invoke shows response in modal
///
/// Data:
///   GET /api/v1/agents/uuid-1 → mockAgent
///   POST /api/v1/agents/uuid-1/invoke → { result: 'Weather: Sunny 25C' }
///
/// Execution:
///   1. Render AgentDetailScreen with id=uuid-1
///   2. Wait for agent data to load
///   3. Press Invoke button
///   4. Wait for modal to appear with response
///
/// Expected:
///   - Agent name 'Weather Agent' visible
///   - Endpoint visible
///   - After invoke: modal shows 'Weather: Sunny 25C'
///   - Modal has Close button
describe('AgentDetailScreen', () => {
  beforeEach(() => {
    const { getApiClient } = require('../../src/api');
    const mockGet = jest.fn().mockResolvedValue({ data: mockAgent });
    const mockPost = jest.fn().mockResolvedValue({ data: { result: 'Weather: Sunny 25C' } });
    getApiClient.mockReturnValue({ get: mockGet, post: mockPost });
  });

  it('renders agent details', async () => {
    render(<AgentDetailScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    expect(screen.getByText('http://weather.local/invoke')).toBeTruthy();
    expect(screen.getByText('Invoke')).toBeTruthy();
  });

  it('shows invoke response in modal', async () => {
    render(<AgentDetailScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Invoke'));

    await waitFor(() => {
      expect(screen.getByText('Invoke Response')).toBeTruthy();
    });

    expect(screen.getByText('Weather: Sunny 25C')).toBeTruthy();
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('closes modal on Close press', async () => {
    render(<AgentDetailScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Invoke'));

    await waitFor(() => {
      expect(screen.getByText('Invoke Response')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Close'));

    await waitFor(() => {
      expect(screen.queryByText('Invoke Response')).toBeNull();
    });
  });
});

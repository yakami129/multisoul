import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentListScreen from './index';

const mockPush = jest.fn();
const mockFetchAllAgents = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../../src/store/endpointStore', () => ({
  useEndpointStore: (selector: any) =>
    selector({
      endpoints: [
        {
          id: 'ep-1',
          label: 'Mac',
          base_url: 'http://localhost:8080',
          token: 'token-1',
        },
      ],
    }),
}));

jest.mock('../../src/features/agents/services/agentService', () => ({
  fetchAllAgents: (...args: unknown[]) => mockFetchAllAgents(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('AgentListScreen', () => {
  function renderScreen() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <AgentListScreen />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockFetchAllAgents.mockReset();
  });

  it('opens chat directly when an agent card is pressed', async () => {
    mockFetchAllAgents.mockResolvedValue([
      {
        id: 'a1',
        name: 'Alpha Agent',
        project_path: '/repo/alpha',
        runtime: 'codex',
        created_at: 1,
        endpoint_id: 'ep-1',
        endpoint_label: 'Mac',
      },
    ]);

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('ALPHA AGENT')).toBeTruthy());
    fireEvent.press(getByText('ALPHA AGENT'));

    expect(mockPush).toHaveBeenCalledWith(
      '/agent/a1/chat?endpoint_id=ep-1&agent_name=Alpha%20Agent',
    );
  });

  it('URL-encodes agent names when opening chat from a card', async () => {
    mockFetchAllAgents.mockResolvedValue([
      {
        id: 'a2',
        name: '修复 Bot/QA',
        project_path: '/repo/beta',
        runtime: 'claude-code',
        created_at: 2,
        endpoint_id: 'ep-1',
        endpoint_label: 'Mac',
      },
    ]);

    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('修复 BOT/QA')).toBeTruthy());
    fireEvent.press(getByText('修复 BOT/QA'));

    expect(mockPush).toHaveBeenCalledWith(
      `/agent/a2/chat?endpoint_id=ep-1&agent_name=${encodeURIComponent('修复 Bot/QA')}`,
    );
  });
});

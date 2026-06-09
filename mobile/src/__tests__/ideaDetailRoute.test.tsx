import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { type Endpoint } from '@/types';
import IdeaDetailRoute from '../../app/idea/[id]';

const mockPush = jest.fn();
const mockSaveIdea = jest.fn();
const mockLoadAssets = jest.fn();
const mockSyncSpecIdeaBeforeServerAction = jest.fn();
const mockStartSpecIdeaInterview = jest.fn();
const mockUpdateIdea = jest.fn();

const endpoint: Endpoint = {
  id: 'ep-1',
  label: 'Office Mac',
  base_url: 'http://office.local:8765',
  token: 'tok-office',
  last_seen_at: 10,
};

const pendingIdea = {
  id: 'idea-1',
  title: 'Fix onboarding',
  status: 'open' as const,
  targetAgentId: 'agent-1',
  targetEndpointId: 'ep-1',
  targetRepoPath: '/repo/multisoul',
  targetAgentName: 'Codex Runner',
  body: 'Make onboarding clearer',
  notes: [],
  attachments: [],
  createdAt: 1,
  updatedAt: 2,
  pendingMutation: 'create' as const,
};

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
}));

jest.mock('@/features/agents/services/agentService', () => ({
  fetchAllAgents: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/features/specs/components/IdeaEditorSheet', () => ({
  IdeaEditorSheet: () => null,
}));

jest.mock('@/components/agent-target', () => ({
  AgentTargetPickerSheet: () => null,
  AgentTargetField: () => null,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'idea-1' }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));

jest.mock('@/store/endpointStore', () => ({
  useEndpointStore: (selector: (state: { endpoints: Endpoint[] }) => unknown) =>
    selector({ endpoints: [endpoint] }),
}));

jest.mock('../../src/store/specStore', () => ({
  useSpecStore: (
    selector: (state: {
      ideas: (typeof pendingIdea)[];
      loadAssets: typeof mockLoadAssets;
      archiveIdea: jest.Mock;
      unarchiveIdea: jest.Mock;
      updateIdea: jest.Mock;
    }) => unknown,
  ) =>
    selector({
      ideas: [pendingIdea],
      loadAssets: mockLoadAssets,
      archiveIdea: jest.fn(),
      unarchiveIdea: jest.fn(),
      updateIdea: mockUpdateIdea,
    }),
}));

jest.mock('@/features/specs/services/specAssetRepository', () => ({
  saveIdea: (...args: unknown[]) => mockSaveIdea(...args),
}));

jest.mock('@/features/specs/services/specAssetService', () => ({
  syncSpecIdeaBeforeServerAction: (...args: unknown[]) =>
    mockSyncSpecIdeaBeforeServerAction(...args),
  startSpecIdeaInterview: (...args: unknown[]) => mockStartSpecIdeaInterview(...args),
}));

jest.mock('@/features/specs/components/IdeaDetailScreen', () => ({
  IdeaDetailScreen: (props: { onStartInterview?: () => void; errorMessage?: string }) => {
    const { Text, TouchableOpacity, View } = require('react-native');
    return (
      <View>
        <TouchableOpacity accessibilityRole="button" onPress={props.onStartInterview}>
          <Text>Start Interview</Text>
        </TouchableOpacity>
        {props.errorMessage ? <Text>{props.errorMessage}</Text> : null}
      </View>
    );
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadAssets.mockResolvedValue(undefined);
  mockSaveIdea.mockResolvedValue(undefined);
  mockSyncSpecIdeaBeforeServerAction.mockResolvedValue({
    ...pendingIdea,
    pendingMutation: undefined,
    updatedAt: 3,
  });
  mockStartSpecIdeaInterview.mockResolvedValue({ conversationId: 'conv-1' });
});

test('syncs a pending local idea before starting its interview', async () => {
  const { getByText } = render(<IdeaDetailRoute />);

  fireEvent.press(getByText('Start Interview'));

  await waitFor(() => {
    expect(mockSyncSpecIdeaBeforeServerAction).toHaveBeenCalledWith(endpoint, pendingIdea);
    expect(mockStartSpecIdeaInterview).toHaveBeenCalledWith(endpoint, 'idea-1');
    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-1?endpoint_id=ep-1&agent_id=agent-1&agent_name=Codex%20Runner',
    );
  });
  expect(mockSaveIdea).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'idea-1', pendingMutation: undefined }),
    null,
    null,
  );
});

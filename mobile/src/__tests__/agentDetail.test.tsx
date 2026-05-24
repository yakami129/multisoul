import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import AgentDetailScreen from '../../app/agent/[id]/index';
import { useEndpointStore } from '../store/endpointStore';

const mockPush = jest.fn();

type AgentDetailFocusHarness = {
  simulateRefocus?: () => void;
};

(globalThis as unknown as { __MS_AGENT_FOCUS: AgentDetailFocusHarness }).__MS_AGENT_FOCUS = {};

jest.mock('../features/agents/services/agentService', () => ({
  fetchAgent: jest.fn(),
}));

jest.mock('../features/chat/services/chatService', () => ({
  abortConversation: jest.fn(),
  createConversation: jest.fn(),
  deleteConversation: jest.fn(),
  fetchConversations: jest.fn(),
}));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children, renderRightActions }: any) => (
      <View>
        {children}
        {renderRightActions?.()}
      </View>
    ),
  };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'uuid-1', endpoint_id: 'ep-1' }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => (() => void) | void) => {
    const { useEffect } = require('react');
    const g = globalThis as unknown as { __MS_AGENT_FOCUS: AgentDetailFocusHarness };
    useEffect(() => {
      let cleanup: void | (() => void);
      const run = () => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
        cleanup = cb();
      };
      g.__MS_AGENT_FOCUS.simulateRefocus = run;
      run();
      return () => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
        delete g.__MS_AGENT_FOCUS?.simulateRefocus;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- jest mock: registers refocus simulator for tests
    }, []);
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
    abortConversation,
    createConversation,
    deleteConversation,
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
    abortConversation.mockResolvedValue(undefined);
    deleteConversation.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      useEndpointStore.setState({ endpoints: [] });
    });
    fetchAgent.mockReset();
    fetchConversations.mockReset();
    createConversation.mockReset();
    abortConversation.mockReset();
    deleteConversation.mockReset();
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

  /// Project Detail delete: running recent chats must abort before being deleted.
  ///
  /// Data:
  ///   recent chat = conv-existing, status running, endpoint ep-1
  ///   endpoint    = http://localhost:8765 / tok
  ///
  /// Execution:
  ///   1. Render AgentDetailScreen.
  ///   2. Press the mocked Swipeable DELETE action for conv-existing.
  ///   3. Wait for abort/delete calls and UI state update.
  ///
  /// Expected:
  ///   - Positive: abortConversation is called before deleteConversation.
  ///   - Positive: deleteConversation targets conv-existing with ep-1 credentials.
  ///   - Positive: the deleted row disappears.
  ///   - Negative: delete is not called before abort.
  it('aborts then deletes a running recent chat from Project Detail', async () => {
    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Look for severe weather warnings')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('DELETE'));

    await waitFor(() => {
      expect(deleteConversation).toHaveBeenCalledWith(
        'http://localhost:8765',
        'tok',
        'conv-existing',
      );
    });

    expect(abortConversation).toHaveBeenCalledWith('http://localhost:8765', 'tok', 'conv-existing');
    expect(abortConversation.mock.invocationCallOrder[0]).toBeLessThan(
      deleteConversation.mock.invocationCallOrder[0],
    );
    await waitFor(() => {
      expect(screen.queryByText('Look for severe weather warnings')).toBeNull();
    });
  });

  /// Project Detail delete: idle recent chats delete directly without abort.
  ///
  /// Data:
  ///   recent chat = conv-idle, status idle, endpoint ep-1
  ///
  /// Execution:
  ///   1. Render AgentDetailScreen with one idle recent chat.
  ///   2. Press DELETE.
  ///   3. Inspect service calls and rendered list.
  ///
  /// Expected:
  ///   - Positive: deleteConversation targets conv-idle.
  ///   - Positive: the idle row disappears after delete succeeds.
  ///   - Negative: abortConversation is not called for idle conversations.
  it('deletes an idle recent chat without aborting', async () => {
    fetchConversations.mockResolvedValue([
      {
        id: 'conv-idle',
        agent_id: 'uuid-1',
        title: 'New Chat',
        created_at: 1,
        last_message_at: 2,
        status: 'idle',
        endpoint_id: 'ep-1',
        agent_name: 'Weather Agent',
        first_user_message: 'Summarize the forecast',
        last_ai_reply: 'Forecast summary is ready',
      },
    ]);

    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Summarize the forecast')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('DELETE'));

    await waitFor(() => {
      expect(deleteConversation).toHaveBeenCalledWith('http://localhost:8765', 'tok', 'conv-idle');
    });

    expect(abortConversation).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText('Summarize the forecast')).toBeNull();
    });
  });

  /// Project Detail delete failure: failed endpoint deletes leave the row visible.
  ///
  /// Data:
  ///   recent chat = conv-idle, status idle
  ///   deleteConversation rejects with network error
  ///
  /// Execution:
  ///   1. Render AgentDetailScreen.
  ///   2. Press DELETE.
  ///   3. Let the rejected delete promise settle.
  ///
  /// Expected:
  ///   - Positive: deleteConversation is attempted.
  ///   - Positive: the row remains visible after failure.
  ///   - Negative: abortConversation is not called for idle failed deletion.
  it('keeps a recent chat visible when delete fails', async () => {
    fetchConversations.mockResolvedValue([
      {
        id: 'conv-idle',
        agent_id: 'uuid-1',
        title: 'New Chat',
        created_at: 1,
        last_message_at: 2,
        status: 'idle',
        endpoint_id: 'ep-1',
        agent_name: 'Weather Agent',
        first_user_message: 'Keep this row',
        last_ai_reply: 'Still here',
      },
    ]);
    deleteConversation.mockRejectedValueOnce(new Error('delete failed'));

    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Keep this row')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('DELETE'));

    await waitFor(() => {
      expect(deleteConversation).toHaveBeenCalledWith('http://localhost:8765', 'tok', 'conv-idle');
    });

    expect(screen.getByText('Keep this row')).toBeTruthy();
    expect(abortConversation).not.toHaveBeenCalled();
  });

  it('refocus silently refreshes data without returning to loading screen', async () => {
    const g = (globalThis as unknown as { __MS_AGENT_FOCUS: AgentDetailFocusHarness })
      .__MS_AGENT_FOCUS;

    render(<AgentDetailScreen />);

    await waitFor(() => {
      expect(screen.getByText('Weather Agent')).toBeTruthy();
      expect(fetchAgent).toHaveBeenCalledTimes(1);
      expect(fetchConversations).toHaveBeenCalledTimes(1);
    });

    fetchConversations.mockResolvedValue([
      {
        id: 'conv-after-refocus',
        agent_id: 'uuid-1',
        title: 'New Chat',
        created_at: 5,
        last_message_at: 6,
        status: 'idle',
        endpoint_id: 'ep-1',
        agent_name: 'Weather Agent',
        first_user_message: 'After refocus list',
        last_ai_reply: 'Updated snippet',
      },
    ]);

    await act(async () => {
      g.simulateRefocus?.();
    });

    await waitFor(() => {
      expect(screen.getByText('After refocus list')).toBeTruthy();
      expect(fetchAgent).toHaveBeenCalledTimes(2);
      expect(fetchConversations).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText('Loading...')).toBeNull();
  });
});

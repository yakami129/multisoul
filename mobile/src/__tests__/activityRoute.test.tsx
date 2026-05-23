import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { useChatStore } from '@/store/chatStore';
import { type InboxItem } from '@/types';
import ActivityTab from '../../app/(tabs)/activity';

const mockPush = jest.fn();
const mockMarkRead = jest.fn().mockResolvedValue(undefined);
const mockLoad = jest.fn().mockResolvedValue(undefined);

const mockPendingQuestion: InboxItem = {
  id: 'ask-1',
  endpoint_id: 'endpoint-1',
  agent_id: 'agent-1',
  conversation_id: 'conv-1',
  kind: 'pending_question',
  title: 'Deploy Project',
  body: 'Deploy now?',
  payload: {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  received_at: Date.now(),
  read_at: null,
};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/store/inboxStore', () => ({
  useInboxStore: (sel: (s: unknown) => unknown) =>
    sel({
      items: [mockPendingQuestion],
      markRead: mockMarkRead,
      removeItem: jest.fn(),
      load: mockLoad,
    }),
}));

describe('ActivityTab routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-running',
          agent_id: 'agent-2',
          title: 'New Chat',
          created_at: Date.now() - 2000,
          last_message_at: Date.now() - 1000,
          status: 'running',
          endpoint_id: 'endpoint-1',
          agent_name: 'Auth Project',
          first_user_message: 'Tighten sign in states',
          last_ai_reply: 'I am checking the sign in state machine',
        },
        {
          id: 'conv-done',
          agent_id: 'agent-3',
          title: 'New Chat',
          created_at: Date.now() - 5000,
          last_message_at: Date.now() - 3000,
          status: 'completed',
          endpoint_id: 'endpoint-1',
          agent_name: 'Docs Project',
          first_user_message: 'Ship release notes',
          last_ai_reply: 'Release notes are ready',
        },
      ],
      messages: {},
    });
  });

  it('renders Activity sections with pending, running, and done items', () => {
    render(<ActivityTab />);

    expect(screen.getByText('Activity')).toBeTruthy();
    expect(screen.getByText('Needs Attention')).toBeTruthy();
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Deploy now?')).toBeTruthy();
    expect(screen.getByText('Tighten sign in states')).toBeTruthy();
    expect(screen.getByText('I am checking the sign in state machine')).toBeTruthy();
    expect(screen.getByText('Ship release notes')).toBeTruthy();
    expect(screen.getByText('Release notes are ready')).toBeTruthy();
  });

  it('opens a pending decision with focus_ask_id', () => {
    render(<ActivityTab />);

    fireEvent.press(screen.getByLabelText('Open Deploy now?'));

    expect(mockMarkRead).toHaveBeenCalledWith('ask-1');
    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-1?endpoint_id=endpoint-1&agent_id=agent-1&agent_name=Deploy%20Project&focus_ask_id=ask-1',
    );
  });

  it('opens a running conversation at Chat Detail', () => {
    render(<ActivityTab />);

    fireEvent.press(screen.getByLabelText('Open Tighten sign in states'));

    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-running?endpoint_id=endpoint-1&agent_id=agent-2&agent_name=Auth%20Project',
    );
  });
});

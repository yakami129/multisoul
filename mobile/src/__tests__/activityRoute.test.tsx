import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { sendConversationAnswer } from '@/features/chat/services/chatService';
import { markAskAnswered } from '@/features/inbox/services/inboxService';
import { useEndpointStore } from '@/store/endpointStore';
import { type InboxItem } from '@/types';
import ActivityTab from '../../app/(tabs)/activity';

const mockRemoveItem = jest.fn().mockResolvedValue(undefined);
const mockLoad = jest.fn().mockResolvedValue(undefined);
const mockMarkAnswered = jest.fn();

const mockPendingQuestion: InboxItem = {
  id: 'ask-1',
  endpoint_id: 'endpoint-1',
  agent_id: 'agent-1',
  conversation_id: 'conv-1',
  kind: 'pending_question',
  title: 'Agent',
  body: 'Deploy now?',
  payload: {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  received_at: 1,
  read_at: null,
};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/features/chat/services/chatService', () => ({
  sendConversationAnswer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  markAskAnswered: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/store/chatStore', () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      markAnswered: mockMarkAnswered,
    }),
}));

jest.mock('@/store/inboxStore', () => ({
  useInboxStore: (sel: (s: unknown) => unknown) =>
    sel({
      items: [mockPendingQuestion],
      markRead: jest.fn(),
      removeItem: mockRemoveItem,
      load: mockLoad,
    }),
}));

jest.mock('@/features/inbox/components/InboxScreen', () => {
  return function MockInboxScreen({ title, onAnswer, onAnswerMulti }: any) {
    const { Button, Text } = require('react-native');
    return (
      <>
        <Text>{title}</Text>
        <Button
          title="Answer single"
          onPress={() => onAnswer(mockPendingQuestion, 'ask-1', 'yes')}
        />
        <Button
          title="Answer multi"
          onPress={() => onAnswerMulti(mockPendingQuestion, 'ask-1', { '0': 'yes' })}
        />
      </>
    );
  };
});

describe('ActivityTab answering pending questions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEndpointStore.setState({
      endpoints: [
        {
          id: 'endpoint-1',
          label: 'Local',
          base_url: 'http://localhost:8080',
          token: 'token',
          last_seen_at: null,
        },
      ],
    });
  });

  it('renders the activity title through the reused inbox screen', () => {
    const { getByText } = render(<ActivityTab />);
    expect(getByText('Activity')).toBeTruthy();
  });

  it('persists answered ask state after answering a single question from activity', async () => {
    const { getByText } = render(<ActivityTab />);

    fireEvent.press(getByText('Answer single'));

    await waitFor(() =>
      expect(sendConversationAnswer).toHaveBeenCalledWith(
        'http://localhost:8080',
        'token',
        'conv-1',
        { ask_id: 'ask-1', choice_id: 'yes', freeform: undefined },
      ),
    );
    expect(markAskAnswered).toHaveBeenCalledWith('ask-1', 'conv-1', 'yes');
  });

  it('persists answered ask state after answering a multi question from activity', async () => {
    const { getByText } = render(<ActivityTab />);

    fireEvent.press(getByText('Answer multi'));

    await waitFor(() =>
      expect(sendConversationAnswer).toHaveBeenCalledWith(
        'http://localhost:8080',
        'token',
        'conv-1',
        { ask_id: 'ask-1', choice_ids: { '0': 'yes' } },
      ),
    );
    expect(markAskAnswered).toHaveBeenCalledWith('ask-1', 'conv-1', undefined, { '0': 'yes' });
  });
});

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { fetchMessages } from '@/features/chat/services/chatService';
import { useEndpointStore } from '@/store/endpointStore';
import { useInboxStore } from '@/store/inboxStore';
import { type WsMessage } from '@/types';
import AgentChatRoute from '../../app/agent/[id]/chat';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    id: 'agent-1',
    endpoint_id: 'endpoint-1',
    agent_name: 'Deploy Bot',
    conv_id: 'conv-1',
  }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    status: 'open',
    sendAnswer: jest.fn(),
    sendAnswerMulti: jest.fn(),
  }),
}));

jest.mock('@/features/chat/services/chatService', () => ({
  createConversation: jest.fn(),
  fetchMessages: jest.fn(),
  postMessage: jest.fn(),
  uploadImage: jest.fn(),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  writeInboxItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/chat/components/MessageBubble', () => ({
  MessageBubble: ({ msg }: any) => {
    const { Text } = require('react-native');
    return (
      <Text>{msg.role === 'ask_question' ? msg.payload.questions[0].text : msg.payload.text}</Text>
    );
  },
}));

const askMessage: WsMessage = {
  type: 'message',
  seq: 3,
  role: 'ask_question',
  payload: {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  created_at: 3,
};

describe('AgentChatRoute', () => {
  beforeEach(() => {
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
    useInboxStore.setState({ items: [] });
    (fetchMessages as jest.Mock).mockResolvedValue([askMessage]);
  });

  it('mirrors unanswered ask_question messages loaded from notification deep-link history to inbox', async () => {
    render(<AgentChatRoute />);

    await waitFor(() =>
      expect(useInboxStore.getState().items[0]).toMatchObject({
        id: 'ask-1',
        kind: 'pending_question',
        body: 'Deploy now?',
      }),
    );
  });

  it('renders an explicit image picker button in the composer', () => {
    const { getByLabelText, getByTestId } = render(<AgentChatRoute />);

    expect(getByLabelText('Attach image')).toBeTruthy();
    expect(getByTestId('attach-image-button')).toBeTruthy();
  });
});

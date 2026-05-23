import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { useChatStore } from '@/store/chatStore';
import { type InboxItem, type WsMessage } from '@/types';
import ActivityTab from '../../app/(tabs)/activity';

const mockPush = jest.fn();
const mockMarkRead = jest.fn().mockResolvedValue(undefined);
const mockLoad = jest.fn().mockResolvedValue(undefined);
const mockLoadAnsweredAsks = jest.fn().mockResolvedValue(new Map());

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

const mockAnsweredQuestion: InboxItem = {
  id: 'ask-answered',
  endpoint_id: 'endpoint-1',
  agent_id: 'agent-1',
  conversation_id: 'conv-answered',
  kind: 'pending_question',
  title: 'Deploy Project',
  body: 'Already answered?',
  payload: {
    ask_id: 'ask-answered',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Already answered?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  received_at: Date.now() - 500,
  read_at: null,
};

let mockInboxItems: InboxItem[] = [mockPendingQuestion];

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/store/inboxStore', () => ({
  useInboxStore: (sel: (s: unknown) => unknown) =>
    sel({
      items: mockInboxItems,
      markRead: mockMarkRead,
      removeItem: jest.fn(),
      load: mockLoad,
    }),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  loadAnsweredAsks: (conversationId: string) => mockLoadAnsweredAsks(conversationId),
}));

describe('ActivityTab routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInboxItems = [mockPendingQuestion];
    mockLoadAnsweredAsks.mockResolvedValue(new Map());
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

  it('renders Activity sections with pending, running, and done items', async () => {
    render(<ActivityTab />);

    expect(screen.getByText('Activity')).toBeTruthy();
    expect(screen.getByText('Needs Attention')).toBeTruthy();
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
    await waitFor(() =>
      expect({
        actual: screen.queryByText('Deploy now?') != null,
        reason: 'inbox fallback pending row should render after answered_asks is checked',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );
    expect(screen.getByText('Tighten sign in states')).toBeTruthy();
    expect(screen.getByText('I am checking the sign in state machine')).toBeTruthy();
    expect(screen.getByText('Ship release notes')).toBeTruthy();
    expect(screen.getByText('Release notes are ready')).toBeTruthy();
  });

  it('opens a pending decision with focus_ask_id', async () => {
    render(<ActivityTab />);

    await waitFor(() =>
      expect({
        actual: screen.queryByLabelText('Open Deploy now?') != null,
        reason: 'pending item must be available before testing the route push',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );

    fireEvent.press(screen.getByLabelText('Open Deploy now?'));

    expect(mockMarkRead).toHaveBeenCalledWith('ask-1');
    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-1?endpoint_id=endpoint-1&agent_id=agent-1&agent_name=Deploy%20Project&focus_ask_id=ask-1',
    );
  });

  it('opens a running conversation at Chat Detail', async () => {
    render(<ActivityTab />);

    await waitFor(() =>
      expect({
        actual: screen.queryByText('Deploy now?') != null,
        reason: 'answered_asks cache should settle before testing unrelated row navigation',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );

    fireEvent.press(screen.getByLabelText('Open Tighten sign in states'));

    expect(mockPush).toHaveBeenCalledWith(
      '/chat/conv-running?endpoint_id=endpoint-1&agent_id=agent-2&agent_name=Auth%20Project',
    );
  });

  /// Pending filter data source: only unanswered ask_question cards should render.
  ///
  /// Data construction:
  ///   ask-1            = inbox fallback pending question, no answered_asks record
  ///   ask-answered     = stale inbox pending question, answered_asks contains this ask id
  ///   conv-running     = running conversation, belongs outside Pending
  ///   conv-done        = completed conversation, belongs outside Pending
  ///
  /// Execution process:
  ///   1. Render Activity with two inbox rows, one stale answered row and one unanswered row.
  ///   2. Wait for answered_asks cache to load for each inbox conversation.
  ///   3. Press the Pending chip so only unanswered decision cards remain visible.
  ///
  /// Expected result:
  ///   - Positive: "Deploy now?" exists because the user has not filled that card.
  ///   - Negative: "Already answered?" does not exist because answered_asks marks it complete.
  ///   - Negative: running/done conversation previews do not appear under the Pending filter.
  it('renders only unanswered question cards in the Pending filter', async () => {
    mockInboxItems = [mockPendingQuestion, mockAnsweredQuestion];
    mockLoadAnsweredAsks.mockImplementation((conversationId: string) => {
      if (conversationId === 'conv-answered') {
        return Promise.resolve(new Map([['ask-answered', { choice_id: 'yes' }]]));
      }
      return Promise.resolve(new Map());
    });

    render(<ActivityTab />);

    await waitFor(() =>
      expect({
        actual: mockLoadAnsweredAsks.mock.calls.some(([id]) => id === 'conv-answered'),
        reason: 'Activity must consult answered_asks before rendering inbox fallback rows',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );

    fireEvent.press(screen.getByLabelText('Show Pending activity'));

    expect({
      actual: screen.queryByText('Deploy now?') != null,
      reason: 'unanswered ask-1 should remain visible in Pending',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Already answered?'),
      reason: 'answered ask should be excluded from Pending even if a stale inbox row exists',
    }).toEqual({ actual: null, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Tighten sign in states'),
      reason: 'running conversation preview must not appear while Pending is selected',
    }).toEqual({ actual: null, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Ship release notes'),
      reason: 'done conversation preview must not appear while Pending is selected',
    }).toEqual({ actual: null, reason: expect.any(String) });
  });

  /// Pending data source precedence: loaded Chat cards should override stale inbox rows.
  ///
  /// Data construction:
  ///   ask-loaded-open      = Chat message with answered omitted/false
  ///   ask-loaded-answered  = Chat message with answered=true
  ///   matching inbox rows  = same ask ids as the loaded Chat messages
  ///
  /// Execution process:
  ///   1. Seed chatStore.messages for two conversations with one open and one answered card.
  ///   2. Render Activity and select Pending.
  ///   3. Inspect the visible decision summaries.
  ///
  /// Expected result:
  ///   - Positive: the open Chat ask card is visible.
  ///   - Negative: the answered Chat ask card is hidden even when an inbox row still exists.
  it('uses loaded Chat ask_question answered state before inbox fallback rows', async () => {
    const openAsk: WsMessage = {
      type: 'message',
      seq: 4,
      role: 'ask_question',
      payload: {
        ask_id: 'ask-loaded-open',
        allow_freeform: false,
        questions: [{ id: '0', text: 'Choose region?', options: [{ id: 'iad', label: 'IAD' }] }],
      },
      created_at: Date.now() - 800,
    };
    const answeredAsk: WsMessage = {
      type: 'message',
      seq: 5,
      role: 'ask_question',
      payload: {
        ask_id: 'ask-loaded-answered',
        allow_freeform: false,
        questions: [
          { id: '0', text: 'Choose database?', options: [{ id: 'pg', label: 'Postgres' }] },
        ],
      },
      created_at: Date.now() - 700,
      answered: true,
    };
    mockInboxItems = [
      mockPendingQuestion,
      {
        ...mockPendingQuestion,
        id: 'ask-loaded-open',
        conversation_id: 'conv-running',
        body: 'Choose region?',
        payload: openAsk.payload,
      },
      {
        ...mockPendingQuestion,
        id: 'ask-loaded-answered',
        conversation_id: 'conv-done',
        body: 'Choose database?',
        payload: answeredAsk.payload,
      },
    ];
    useChatStore.setState((state) => ({
      ...state,
      messages: {
        'conv-running': [openAsk],
        'conv-done': [answeredAsk],
      },
    }));

    render(<ActivityTab />);
    await waitFor(() =>
      expect({
        actual: screen.queryByText('Deploy now?') != null,
        reason: 'inbox fallback cache should settle before filtering loaded Chat questions',
      }).toEqual({ actual: true, reason: expect.any(String) }),
    );
    fireEvent.press(screen.getByLabelText('Show Pending activity'));

    expect({
      actual: screen.queryByText('Choose region?') != null,
      reason: 'unanswered loaded Chat ask should render in Pending',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: screen.queryByText('Choose database?'),
      reason: 'answered loaded Chat ask should hide its stale inbox fallback',
    }).toEqual({ actual: null, reason: expect.any(String) });
  });
});

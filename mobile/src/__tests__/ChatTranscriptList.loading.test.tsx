import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import type { WsMessage } from '@/types';
import ChatTranscriptList from '../../app/chat/ChatTranscriptList';

jest.mock('@/features/chat/components/MessageBubble', () => ({
  MessageBubble: ({ msg, waiting }: any) => {
    const { Text } = require('react-native');
    return <Text>{waiting ? 'waiting' : msg.payload.text}</Text>;
  },
}));

const message: WsMessage = {
  type: 'message',
  seq: 1,
  role: 'agent_text',
  payload: { text: 'hello' },
  created_at: 1,
};

function renderList(isLoadingOlder: boolean) {
  return render(
    <ChatTranscriptList
      listRef={{ current: null }}
      messages={[message]}
      conversationStatus="idle"
      isLoadingOlder={isLoadingOlder}
      isAgentRunning={false}
      incomingAgentActivitySeq={null}
      activeTypewriterSeq={null}
      shouldForceComplete={false}
      serverUrl="http://localhost:8080"
      token="token"
      onAnswer={jest.fn()}
      onAnswerMulti={jest.fn()}
      imageUriForMessage={() => undefined}
      onScroll={jest.fn()}
      onScrollBeginDrag={jest.fn()}
      onContentSizeChange={jest.fn()}
      onScrollToIndexFailed={jest.fn()}
    />,
  );
}

/// Older loading header: ChatTranscriptList should expose a transparent top
/// spinner while older messages are being fetched.
///
/// Data construction:
///   messages length = 1, so the FlatList has normal transcript content
///   isLoadingOlder = true, so the header should render
///   required header height = 40 px, with 8 px vertical padding
///
/// Execution process:
///   1. Render ChatTranscriptList with isLoadingOlder=true.
///   2. Inspect the header wrapper and ActivityIndicator props.
///   3. Inspect the FlatList maintainVisibleContentPosition prop.
///
/// Expected result:
///   - Positive: older loading wrapper exists and is 40 px tall.
///   - Positive: ActivityIndicator uses signal live cyan.
///   - Negative: the list position lock is not removed.
test('renders the top older-loading header while loading older messages', () => {
  const { getByTestId, UNSAFE_getByType } = renderList(true);
  const headerStyle = StyleSheet.flatten(getByTestId('older-messages-loading').props.style);
  const indicator = UNSAFE_getByType(ActivityIndicator);
  const list = UNSAFE_getByType(FlatList);

  expect({
    actual: headerStyle.height,
    reason: 'older loading header must reserve the specified 40px top area',
  }).toEqual({ actual: 40, reason: expect.any(String) });
  expect({
    actual: headerStyle.backgroundColor,
    reason: 'older loading header must stay transparent and not cover transcript content',
  }).toEqual({ actual: 'transparent', reason: expect.any(String) });
  expect({
    actual: indicator.props.color,
    reason: 'older loading spinner must use the chat accent color',
  }).toEqual({ actual: '#00E5FF', reason: expect.any(String) });
  expect({
    actual: list.props.maintainVisibleContentPosition,
    reason: 'top loading header must keep FlatList visible-position locking enabled',
  }).toEqual({ actual: { minIndexForVisible: 0 }, reason: expect.any(String) });
});

/// Older loading idle state: no header should render when older pagination is
/// idle, including when transcript content itself is present.
///
/// Data construction:
///   messages length = 1
///   isLoadingOlder = false
///
/// Execution process:
///   1. Render ChatTranscriptList with isLoadingOlder=false.
///   2. Query the older loading test id.
///   3. Inspect the FlatList header prop.
///
/// Expected result:
///   - Positive: normal message content still renders.
///   - Negative: older loading wrapper is absent.
///   - Negative: FlatList receives no header component while idle.
test('does not render the older-loading header while idle', () => {
  const { getByText, queryByTestId, UNSAFE_getByType } = renderList(false);
  const list = UNSAFE_getByType(FlatList);

  expect({
    actual: getByText('hello') != null,
    reason: 'idle transcript should still render regular messages',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: queryByTestId('older-messages-loading'),
    reason: 'idle transcript must not reserve top loading space',
  }).toEqual({ actual: null, reason: expect.any(String) });
  expect({
    actual: list.props.ListHeaderComponent,
    reason:
      'idle transcript must pass no FlatList header so contentContainerStyle gap adds no top space',
  }).toEqual({ actual: null, reason: expect.any(String) });
});

test('passes matching tool_result payload into tool call cards', () => {
  const toolCall: WsMessage = {
    type: 'message',
    seq: 10,
    role: 'tool_call',
    payload: { tool: 'Bash', args: '{"command":"pwd"}', call_id: 'call-10' },
    created_at: 10,
  };
  const toolResult: WsMessage = {
    type: 'message',
    seq: 11,
    role: 'tool_result',
    payload: { call_id: 'call-10', ok: true, summary: '/Users/openclawd/Documents/code' },
    created_at: 11,
  };

  const { getByText, getByTestId, queryByText } = render(
    <ChatTranscriptList
      listRef={{ current: null }}
      messages={[toolCall]}
      conversationStatus="idle"
      toolResultMessages={[toolCall, toolResult]}
      isLoadingOlder={false}
      isAgentRunning={false}
      incomingAgentActivitySeq={null}
      activeTypewriterSeq={null}
      shouldForceComplete={false}
      serverUrl="http://localhost:8080"
      token="token"
      onAnswer={jest.fn()}
      onAnswerMulti={jest.fn()}
      imageUriForMessage={() => undefined}
      onScroll={jest.fn()}
      onScrollBeginDrag={jest.fn()}
      onContentSizeChange={jest.fn()}
      onScrollToIndexFailed={jest.fn()}
    />,
  );

  expect(getByText('pwd')).toBeTruthy();
  expect(getByTestId('tool-call-status-label').props.children).toBe('Done');
  expect(queryByText('/Users/openclawd/Documents/code')).toBeNull();
});

test('loads server worked messages only when the row is expanded', () => {
  const onLoadServerWorkedMessages = jest.fn();
  const serverWorked = {
    kind: 'server_worked' as const,
    id: 'worked-turn-10',
    turnId: 'turn-10',
    label: 'Worked for 8s',
    hiddenCount: 2,
    messages: [],
    isLoading: true,
  };

  const rendered = render(
    <ChatTranscriptList
      listRef={{ current: null }}
      messages={[]}
      displayItems={[serverWorked]}
      conversationStatus="completed"
      isLoadingOlder={false}
      isAgentRunning={false}
      incomingAgentActivitySeq={null}
      activeTypewriterSeq={null}
      shouldForceComplete={false}
      serverUrl="http://localhost:8080"
      token="token"
      onLoadServerWorkedMessages={onLoadServerWorkedMessages}
      onAnswer={jest.fn()}
      onAnswerMulti={jest.fn()}
      imageUriForMessage={() => undefined}
      onScroll={jest.fn()}
      onScrollBeginDrag={jest.fn()}
      onContentSizeChange={jest.fn()}
      onScrollToIndexFailed={jest.fn()}
    />,
  );

  expect(onLoadServerWorkedMessages).not.toHaveBeenCalled();
  fireEvent.press(rendered.getByTestId('worked-row'));

  expect(onLoadServerWorkedMessages).toHaveBeenCalledWith('turn-10');
  expect(rendered.getByTestId('worked-row-loading-indicator')).toBeTruthy();
});

function userText(seq: number, text: string, created_at = seq): WsMessage {
  return { type: 'message', seq, role: 'user_text', payload: { text }, created_at };
}

function agentText(seq: number, text: string, created_at = seq): WsMessage {
  return { type: 'message', seq, role: 'agent_text', payload: { text }, created_at };
}

function toolCall(seq: number, call_id: string, created_at = seq): WsMessage {
  return {
    type: 'message',
    seq,
    role: 'tool_call',
    payload: { tool: 'Bash', args: '{"command":"pwd"}', call_id },
    created_at,
  };
}

function renderCompletedList(messages: WsMessage[], toolResultMessages?: WsMessage[]) {
  return render(
    <ChatTranscriptList
      listRef={{ current: null }}
      messages={messages}
      conversationStatus="completed"
      toolResultMessages={toolResultMessages}
      isLoadingOlder={false}
      isAgentRunning={false}
      incomingAgentActivitySeq={null}
      activeTypewriterSeq={null}
      shouldForceComplete={false}
      serverUrl="http://localhost:8080"
      token="token"
      onAnswer={jest.fn()}
      onAnswerMulti={jest.fn()}
      imageUriForMessage={() => undefined}
      onScroll={jest.fn()}
      onScrollBeginDrag={jest.fn()}
      onContentSizeChange={jest.fn()}
      onScrollToIndexFailed={jest.fn()}
    />,
  );
}

/// Display item keys: FlatList keys must remain stable for existing transcript
/// rows when older messages are prepended above them.
///
/// Data construction:
///   base transcript = seq 10 user + seq 11 tool_call + seq 12 agent_text
///   completed folding turns seq 11 into worked id "worked-11-11"
///   older prepend = seq 1 user + seq 2 agent_text, added before the base rows
///
/// Execution process:
///   1. Render the completed base transcript and read FlatList keyExtractor.
///   2. Capture keys for the visible base message rows and worked row.
///   3. Rerender with older messages prepended.
///   4. Capture keys for the same existing base rows after their indexes shift.
///
/// Expected result:
///   - Positive: message rows use "message-${seq}", concretely message-10 and message-12.
///   - Positive: the worked row keeps its existing id "worked-11-11".
///   - Negative: existing rows do not fall back to bare numeric message keys after prepend.
test('uses stable display item keys for messages and worked rows after older prepend', () => {
  const existingMessages = [
    userText(10, 'current prompt', 10_000),
    toolCall(11, 'call-11', 11_000),
    agentText(12, 'current answer', 12_000),
  ];
  const olderMessages = [userText(1, 'older prompt', 1_000), agentText(2, 'older answer', 2_000)];
  const rendered = renderCompletedList(existingMessages);
  const listBefore = rendered.UNSAFE_getByType(FlatList);
  const dataBefore = listBefore.props.data;
  const keyExtractor = listBefore.props.keyExtractor as (item: unknown) => string;
  const keysBefore = dataBefore.map((item: unknown) => keyExtractor(item));

  rendered.rerender(
    <ChatTranscriptList
      listRef={{ current: null }}
      messages={[...olderMessages, ...existingMessages]}
      conversationStatus="completed"
      isLoadingOlder={false}
      isAgentRunning={false}
      incomingAgentActivitySeq={null}
      activeTypewriterSeq={null}
      shouldForceComplete={false}
      serverUrl="http://localhost:8080"
      token="token"
      onAnswer={jest.fn()}
      onAnswerMulti={jest.fn()}
      imageUriForMessage={() => undefined}
      onScroll={jest.fn()}
      onScrollBeginDrag={jest.fn()}
      onContentSizeChange={jest.fn()}
      onScrollToIndexFailed={jest.fn()}
    />,
  );
  const listAfter = rendered.UNSAFE_getByType(FlatList);
  const keysAfter = listAfter.props.data.map((item: unknown) => keyExtractor(item));

  expect({
    actual: keysBefore,
    reason: 'base completed transcript should key messages by prefixed seq and worked rows by id',
  }).toEqual({
    actual: ['message-10', 'worked-11-11', 'message-12'],
    reason: expect.any(String),
  });
  expect({
    actual: keysAfter.includes('message-10'),
    reason: 'existing user message key should survive older prepend',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: keysAfter.includes('worked-11-11'),
    reason: 'existing worked row key should remain its stable worked id after older prepend',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: keysAfter.includes('message-12'),
    reason: 'existing final message key should survive older prepend',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: keysAfter.some((key: string) => key === '10' || key === '12'),
    reason: 'message keys must not use bare seq values that collide across display item kinds',
  }).toEqual({ actual: false, reason: expect.any(String) });
});

/// Worked row rendering: completed process rows collapse behind a lightweight
/// borderless trigger and expand inline with original transcript item styles.
///
/// Data construction:
///   seq 1 user_text "first prompt"
///   seq 2 agent_text "progress update" hidden in worked row
///   seq 3 tool_call "call-3" hidden in worked row
///   seq 4 task_status completed hidden in worked row
///   seq 5 final agent_text "final answer" visible
///   seq 6 tool_result for call-3 stays out of FlatList rows but feeds ToolCallRow.
///
/// Execution process:
///   1. Render completed transcript with toolResultMessages including seq 6.
///   2. Verify default collapsed view and worked-row visual constraints.
///   3. Press worked row to expand hidden process rows.
///   4. Press worked row again to collapse them.
///
/// Expected result:
///   - Positive: default view shows user, worked row, and final answer.
///   - Positive: expanded view shows the hidden agent text and tool call result state.
///   - Negative: worked row has no border/card background and hides process text when collapsed.
test('renders a borderless worked row and expands completed transcript work inline', () => {
  const messages = [
    userText(1, 'first prompt', 1_700_000_000_000),
    agentText(2, 'progress update', 1_700_000_010_000),
    toolCall(3, 'call-3', 1_700_000_020_000),
    {
      type: 'message',
      seq: 4,
      role: 'task_status',
      payload: {
        task_id: 'conv-1',
        status: 'completed',
        importance: 'normal',
        summary: '',
      },
      created_at: 1_700_000_030_000,
    } satisfies WsMessage,
    agentText(5, 'final answer', 1_700_000_030_000),
  ];
  const toolResult: WsMessage = {
    type: 'message',
    seq: 6,
    role: 'tool_result',
    payload: { call_id: 'call-3', ok: true, summary: '/Users/openclawd/Documents/code' },
    created_at: 1_700_000_031_000,
  };

  const { getByTestId, getByText, queryByText } = renderCompletedList(messages, [
    ...messages,
    toolResult,
  ]);

  expect(getByText('Worked for 20s')).toBeTruthy();
  expect(getByText('first prompt')).toBeTruthy();
  expect(getByText('final answer')).toBeTruthy();
  expect(queryByText('progress update')).toBeNull();

  const workedRowStyle = StyleSheet.flatten(getByTestId('worked-row').props.style);
  expect({
    actual: workedRowStyle.borderWidth,
    reason: 'worked row must not render as a bordered folding card',
  }).toEqual({ actual: undefined, reason: expect.any(String) });
  expect({
    actual: workedRowStyle.backgroundColor,
    reason: 'worked row must not render a card background',
  }).toEqual({ actual: undefined, reason: expect.any(String) });

  fireEvent.press(getByTestId('worked-row'));

  expect(getByText('progress update')).toBeTruthy();
  expect(getByText('pwd')).toBeTruthy();
  expect(getByTestId('tool-call-status-label').props.children).toBe('Done');

  fireEvent.press(getByTestId('worked-row'));

  expect(queryByText('progress update')).toBeNull();
});

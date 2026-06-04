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

test('renders a borderless worked row and expands completed transcript work inline', () => {
  const messages = [
    userText(1, 'first prompt', 1_700_000_000_000),
    agentText(2, 'progress update', 1_700_000_010_000),
    toolCall(3, 'call-3', 1_700_000_020_000),
    userText(4, 'final prompt', 1_700_000_025_000),
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
  expect(getByText('final prompt')).toBeTruthy();
  expect(getByText('final answer')).toBeTruthy();
  expect(queryByText('first prompt')).toBeNull();
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

  expect(getByText('first prompt')).toBeTruthy();
  expect(getByText('progress update')).toBeTruthy();
  expect(getByText('pwd')).toBeTruthy();
  expect(getByTestId('tool-call-status-label').props.children).toBe('Done');

  fireEvent.press(getByTestId('worked-row'));

  expect(queryByText('first prompt')).toBeNull();
  expect(queryByText('progress update')).toBeNull();
});

import { render } from '@testing-library/react-native';
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

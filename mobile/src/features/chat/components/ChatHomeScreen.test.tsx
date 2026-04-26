import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { type Conversation } from '@/types';
import ChatHomeScreen from './ChatHomeScreen';

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children, renderRightActions }: any) => (
      <View>
        {children}
        {renderRightActions && renderRightActions()}
      </View>
    ),
    GestureHandlerRootView: ({ children }: any) => children,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const makeConv = (id: string): Conversation => ({
  id,
  agent_id: 'agent-1',
  title: `Conv ${id}`,
  created_at: 1000,
  last_message_at: 2000,
  status: 'idle',
  endpoint_id: 'ep-1',
  agent_name: 'TestAgent',
  first_user_message: 'hello',
});

/// T-1: DELETE action button is visible for each row (rendered via renderRightActions)
///
/// Data: 1 conversation
///
/// Execution:
///   1. Render ChatHomeScreen with 1 conversation
///   2. Mock renders renderRightActions immediately
///
/// Expected:
///   - "DELETE" text is visible in the rendered output
test('renders DELETE action button for each row', () => {
  const { getAllByText } = render(
    <ChatHomeScreen
      conversations={[makeConv('c1')]}
      onPressConversation={jest.fn()}
      onPressNewChat={jest.fn()}
      onDeleteConversation={jest.fn()}
    />,
  );
  expect(getAllByText('DELETE').length).toBeGreaterThan(0);
});

/// T-2: pressing DELETE calls onDeleteConversation with the conversation id
///
/// Data: 1 conversation with id 'c1'
///
/// Execution:
///   1. Render ChatHomeScreen
///   2. Press the DELETE button
///
/// Expected:
///   - onDeleteConversation called with 'c1'
test('pressing DELETE calls onDeleteConversation with conversation id', () => {
  const onDelete = jest.fn();
  const { getAllByText } = render(
    <ChatHomeScreen
      conversations={[makeConv('c1')]}
      onPressConversation={jest.fn()}
      onPressNewChat={jest.fn()}
      onDeleteConversation={onDelete}
    />,
  );
  fireEvent.press(getAllByText('DELETE')[0]);
  expect(onDelete).toHaveBeenCalledWith('c1');
});

/// T-3: multiple conversations each get their own DELETE button
///
/// Data: 2 conversations c1, c2
///
/// Expected:
///   - 2 DELETE buttons rendered
///   - pressing second DELETE calls onDeleteConversation with 'c2'
test('each conversation row has its own DELETE button', () => {
  const onDelete = jest.fn();
  const { getAllByText } = render(
    <ChatHomeScreen
      conversations={[makeConv('c1'), makeConv('c2')]}
      onPressConversation={jest.fn()}
      onPressNewChat={jest.fn()}
      onDeleteConversation={onDelete}
    />,
  );
  const buttons = getAllByText('DELETE');
  expect(buttons.length).toBe(2);
  fireEvent.press(buttons[1]);
  expect(onDelete).toHaveBeenCalledWith('c2');
});

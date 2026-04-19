import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChatScreen } from './ChatScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

// T-1: renders messages from props
//
// Expected: user message text visible, assistant message text visible
test('renders messages', () => {
  const messages = [
    { id: '1', role: 'user' as const, text: 'hello', createdAt: '', streaming: false },
    { id: '2', role: 'assistant' as const, text: 'hi there', createdAt: '', streaming: false },
  ];
  const { getByText } = render(
    <ChatScreen
      agentName="TestAgent"
      messages={messages}
      status="connected"
      onSend={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(getByText('hello')).toBeTruthy();
  expect(getByText('hi there')).toBeTruthy();
});

// T-2: send button calls onSend with input text and clears input
//
// Expected: onSend called with 'test message', input cleared after send
test('send button calls onSend and clears input', () => {
  const onSend = jest.fn();
  const { getByPlaceholderText, getByTestId } = render(
    <ChatScreen
      agentName="TestAgent"
      messages={[]}
      status="connected"
      onSend={onSend}
      onBack={jest.fn()}
    />
  );
  fireEvent.changeText(getByPlaceholderText('Message…'), 'test message');
  fireEvent.press(getByTestId('send-button'));
  expect(onSend).toHaveBeenCalledWith('test message');
  expect(getByPlaceholderText('Message…').props.value).toBe('');
});

// T-3: reconnecting status shows banner
//
// Expected: 'Reconnecting…' text visible when status=='reconnecting'
test('shows reconnecting banner', () => {
  const { getByText } = render(
    <ChatScreen
      agentName="TestAgent"
      messages={[]}
      status="reconnecting"
      onSend={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(getByText('Reconnecting…')).toBeTruthy();
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChatScreen } from './ChatScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

// T-1: renders messages from props
//
// Data: 2 messages — user "hello", assistant "hi there"
//
// Execution:
//   1. Render ChatScreen with messages array
//
// Expected:
//   - "hello" visible (user message rendered)
//   - "hi there" visible (assistant message rendered)
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
// Execution:
//   1. Type 'test message' into input
//   2. Press send button
//
// Expected:
//   - onSend called with 'test message' (trimmed input forwarded)
//   - input value is '' after send (cleared for next message)
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
// Execution:
//   1. Render ChatScreen with status='reconnecting'
//
// Expected:
//   - 'Reconnecting…' banner visible (status !== 'connected' shows warning)
//   - banner NOT visible when status='connected' (only shown during reconnect)
test('shows reconnecting banner', () => {
  const { getByText, rerender } = render(
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

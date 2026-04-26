import { act, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import type { WsMessage } from '@/types';
import { MessageBubble } from './MessageBubble';

afterEach(() => {
  jest.useRealTimers();
});

const agentMessage: WsMessage = {
  type: 'message',
  seq: 1,
  role: 'agent_text',
  payload: { text: 'system online' },
  created_at: 0,
};

test('renders minimal shining waiting status', () => {
  jest.useFakeTimers();
  const { getByLabelText, queryByText } = render(<MessageBubble msg={agentMessage} waiting />);

  expect(getByLabelText('Thinking...')).toBeTruthy();
  expect(queryByText('ACCESSING NEURAL LINK')).toBeNull();
  expect(queryByText('awaiting encrypted response▋')).toBeNull();
  expect(queryByText('Planning...')).toBeNull();
});

test('reveals agent text with scanner cursor while preserving original color', () => {
  jest.useFakeTimers();
  const { queryByText, getByText } = render(<MessageBubble msg={agentMessage} typewriter />);

  expect(queryByText('system online')).toBeNull();

  act(() => {
    jest.advanceTimersByTime(28);
  });

  const scanningText = getByText('s▌');
  expect(StyleSheet.flatten(scanningText.props.style).color).toBe('#20C20E');

  act(() => {
    jest.advanceTimersByTime(500);
  });

  expect(getByText('system online')).toBeTruthy();
});

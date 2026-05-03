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

it('renders three pulsing dots with testIDs when waiting=true', () => {
  jest.useFakeTimers();
  const msg: WsMessage = {
    type: 'message',
    seq: -1,
    role: 'agent_text',
    payload: { text: '' },
    created_at: 0,
  };
  const { getByTestId } = render(<MessageBubble msg={msg} waiting />);
  expect(getByTestId('waiting-dot-0')).toBeTruthy();
  expect(getByTestId('waiting-dot-1')).toBeTruthy();
  expect(getByTestId('waiting-dot-2')).toBeTruthy();
  expect(getByTestId('waiting-analyzing-text')).toBeTruthy();
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

describe('MessageBubble image rendering', () => {
  const makeUserMsg = (payload: object): WsMessage => ({
    type: 'message',
    seq: 1,
    role: 'user_text',
    payload: payload as WsMessage['payload'],
    created_at: 0,
  });

  it('renders image thumbnail when imageUri is provided', () => {
    const msg = makeUserMsg({ text: '', file_id: 'abc.jpg' });
    const { getByTestId } = render(<MessageBubble msg={msg} imageUri="file:///local/photo.jpg" />);
    expect(getByTestId('user-image-thumb')).toBeTruthy();
  });

  it('renders attachment placeholder when file_id present but no imageUri', () => {
    const msg = makeUserMsg({ text: '', file_id: 'abc.jpg' });
    const { getByText } = render(<MessageBubble msg={msg} />);
    expect(getByText('📎 Image')).toBeTruthy();
  });

  it('renders plain text bubble when no file_id', () => {
    const msg = makeUserMsg({ text: 'hello' });
    const { getByText } = render(<MessageBubble msg={msg} />);
    expect(getByText('hello')).toBeTruthy();
  });
});

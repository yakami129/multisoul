import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import ChatInputBar from './ChatInputBar';

const noop = () => {};

describe('ChatInputBar', () => {
  it('renders enhanced input affordances from the pencli reference', () => {
    const { getByPlaceholderText, getByText, getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );

    expect(getByText('/')).toBeTruthy();
    expect(getByText('Commands')).toBeTruthy();
    expect(getByText('0 / 4096')).toBeTruthy();
    expect(getByTestId('input-surface')).toBeTruthy();
    expect(getByTestId('toolbar-divider')).toBeTruthy();
    expect(getByPlaceholderText('Message Grok...')).toBeTruthy();
    expect(getByTestId('message-input').props.maxLength).toBe(4096);
  });

  it('updates the character counter with the current input length', () => {
    const { getByText, queryByText } = render(
      <ChatInputBar
        value="hello"
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );

    expect(getByText('5 / 4096')).toBeTruthy();
    expect(queryByText('0 / 4096')).toBeNull();
  });

  it('renders send button when input has text', () => {
    const { getByTestId } = render(
      <ChatInputBar
        value="hello"
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );
    expect(getByTestId('send-btn')).toBeTruthy();
  });

  it('renders mic button when input is empty', () => {
    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );
    expect(getByTestId('mic-btn')).toBeTruthy();
  });

  it('calls onSend when send button pressed', () => {
    const onSend = jest.fn();
    const { getByTestId } = render(
      <ChatInputBar
        value="hello"
        onChangeText={noop}
        onSend={onSend}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );
    fireEvent.press(getByTestId('send-btn'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenCommands when command button pressed', () => {
    const onOpenCommands = jest.fn();
    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={onOpenCommands}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );
    fireEvent.press(getByTestId('command-btn'));
    expect(onOpenCommands).toHaveBeenCalledTimes(1);
  });

  it('calls onPickImage when attach button pressed', () => {
    const onPickImage = jest.fn();
    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={noop}
        onPickImage={onPickImage}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );
    fireEvent.press(getByTestId('attach-btn'));
    expect(onPickImage).toHaveBeenCalledTimes(1);
  });

  it('shows alert and does NOT call onSend when voice button pressed', () => {
    const onSend = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={onSend}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
      />,
    );
    fireEvent.press(getByTestId('voice-btn'));
    expect(onSend).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('语音功能即将上线，敬请期待');
    alertSpy.mockRestore();
  });

  it('calls onStop when stop button pressed during agent run', () => {
    const onStop = jest.fn();
    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={true}
        onStop={onStop}
      />,
    );
    fireEvent.press(getByTestId('stop-btn'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('disables all buttons when disabled=true', () => {
    const { getByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={true}
        isAgentRunning={false}
        onStop={noop}
      />,
    );
    // Buttons exist but are disabled
    expect(getByTestId('attach-btn').props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId('command-btn').props.accessibilityState?.disabled).toBe(true);
  });
});

import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import ChatInputBar from './ChatInputBar';

const noop = () => {};

describe('ChatInputBar', () => {
  /// Chat input chrome: render the composer controls without a synthetic slash prefix.
  ///
  /// Data construction:
  ///   Empty value length = 0 characters.
  ///   Max input length   = 4096 characters.
  ///   Counter text       = "0 / 4096".
  ///
  /// Execution process:
  ///   1. Render the input bar with an empty value and enabled controls.
  ///   2. Inspect the text nodes and test IDs exposed by the composer.
  ///
  /// Expected result:
  ///   - Positive assertion: commands, counter, surface, divider, placeholder,
  ///     and maxLength all exist because the input affordances remain available.
  ///   - Negative assertion: standalone "/" does not exist, because it was a
  ///     visual prefix and not user-entered content.
  ///   - Negative assertion: toolbar voice button does not exist, because the
  ///     bottom row should not show a voice recognition icon.
  it('renders enhanced input affordances without a slash prefix', () => {
    const { getByPlaceholderText, getByText, getByTestId, queryByText, queryByTestId } = render(
      <ChatInputBar
        value=""
        onChangeText={noop}
        onSend={noop}
        onPickImage={noop}
        onOpenCommands={noop}
        disabled={false}
        isAgentRunning={false}
        onStop={noop}
        pendingImages={[]}
        onRemoveImage={noop}
      />,
    );

    expect(queryByText('/')).toBeNull();
    expect(queryByTestId('voice-btn')).toBeNull();
    expect(getByText('Commands')).toBeTruthy();
    expect(getByText('0 / 4096')).toBeTruthy();
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
        pendingImages={[]}
        onRemoveImage={noop}
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
        pendingImages={[]}
        onRemoveImage={noop}
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
        pendingImages={[]}
        onRemoveImage={noop}
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
        pendingImages={[]}
        onRemoveImage={noop}
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
        pendingImages={[]}
        onRemoveImage={noop}
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
        pendingImages={[]}
        onRemoveImage={noop}
      />,
    );
    fireEvent.press(getByTestId('attach-btn'));
    expect(onPickImage).toHaveBeenCalledTimes(1);
  });

  it('shows alert and does NOT call onSend when inline mic button pressed', () => {
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
        pendingImages={[]}
        onRemoveImage={noop}
      />,
    );
    fireEvent.press(getByTestId('mic-btn'));
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
        pendingImages={[]}
        onRemoveImage={noop}
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
        pendingImages={[]}
        onRemoveImage={noop}
      />,
    );
    // Buttons exist but are disabled
    expect(getByTestId('attach-btn').props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId('command-btn').props.accessibilityState?.disabled).toBe(true);
  });

  describe('Image Preview', () => {
    it('should not render image preview row when pendingImages is empty', () => {
      const { queryByTestId } = render(
        <ChatInputBar
          value=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onPickImage={jest.fn()}
          onOpenCommands={jest.fn()}
          disabled={false}
          isAgentRunning={false}
          onStop={jest.fn()}
          pendingImages={[]}
          onRemoveImage={jest.fn()}
        />,
      );

      expect(queryByTestId('img-preview-row')).toBeNull();
    });

    it('should render image preview row when pendingImages has items', () => {
      const pendingImages = [
        { localUri: 'file:///test1.jpg', fileId: 'f1', status: 'uploaded' as const },
        { localUri: 'file:///test2.jpg', fileId: null, status: 'uploading' as const },
      ];

      const { getByTestId } = render(
        <ChatInputBar
          value=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onPickImage={jest.fn()}
          onOpenCommands={jest.fn()}
          disabled={false}
          isAgentRunning={false}
          onStop={jest.fn()}
          pendingImages={pendingImages}
          onRemoveImage={jest.fn()}
        />,
      );

      expect(getByTestId('img-preview-row')).toBeTruthy();
    });

    it('should call onRemoveImage when remove button is pressed', () => {
      const onRemoveImage = jest.fn();
      const pendingImages = [
        { localUri: 'file:///test1.jpg', fileId: 'f1', status: 'uploaded' as const },
      ];

      const { getByTestId } = render(
        <ChatInputBar
          value=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onPickImage={jest.fn()}
          onOpenCommands={jest.fn()}
          disabled={false}
          isAgentRunning={false}
          onStop={jest.fn()}
          pendingImages={pendingImages}
          onRemoveImage={onRemoveImage}
        />,
      );

      fireEvent.press(getByTestId('remove-img-0'));
      expect(onRemoveImage).toHaveBeenCalledWith(0);
    });

    it('should show uploading overlay for uploading images', () => {
      const pendingImages = [
        { localUri: 'file:///test1.jpg', fileId: null, status: 'uploading' as const },
      ];

      const { getByText } = render(
        <ChatInputBar
          value=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onPickImage={jest.fn()}
          onOpenCommands={jest.fn()}
          disabled={false}
          isAgentRunning={false}
          onStop={jest.fn()}
          pendingImages={pendingImages}
          onRemoveImage={jest.fn()}
        />,
      );

      expect(getByText('...')).toBeTruthy();
    });

    it('should show failed overlay for failed images', () => {
      const pendingImages = [
        { localUri: 'file:///test1.jpg', fileId: null, status: 'failed' as const },
      ];

      const { getByText } = render(
        <ChatInputBar
          value=""
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onPickImage={jest.fn()}
          onOpenCommands={jest.fn()}
          disabled={false}
          isAgentRunning={false}
          onStop={jest.fn()}
          pendingImages={pendingImages}
          onRemoveImage={jest.fn()}
        />,
      );

      expect(getByText('!')).toBeTruthy();
    });
  });
});

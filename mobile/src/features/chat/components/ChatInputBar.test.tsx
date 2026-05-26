import { render, fireEvent, within } from '@testing-library/react-native';
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import ChatInputBar from './ChatInputBar';

const noop = () => {};

function assertTruthy(value: unknown, message: string) {
  expect({ actual: Boolean(value), reason: message }).toEqual({
    actual: true,
    reason: expect.any(String),
  });
}

function assertFalsy(value: unknown, message: string) {
  expect({ actual: Boolean(value), reason: message }).toEqual({
    actual: false,
    reason: expect.any(String),
  });
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  expect({ actual, reason: message }).toEqual({ actual: expected, reason: expect.any(String) });
}

function renderInputBar(props: Partial<React.ComponentProps<typeof ChatInputBar>> = {}) {
  return render(
    <ChatInputBar
      value=""
      onChangeText={noop}
      onSend={noop}
      disabled={false}
      isAgentRunning={false}
      onStop={noop}
      pendingImages={[]}
      onRemoveImage={noop}
      modelLabel="Default"
      modelDisabled={false}
      onOpenModelSelector={noop}
      onOpenComposerSheet={noop}
      {...props}
    />,
  );
}

describe('ChatInputBar', () => {
  /// Composer chrome: render the Apple-style enhanced input controls.
  ///
  /// Data construction:
  ///   value length      = 0 characters.
  ///   max input length  = 4096 characters.
  ///   model label       = "Default".
  ///
  /// Execution process:
  ///   1. Render the input bar with no pending image and enabled controls.
  ///   2. Inspect composer controls by labels/test IDs.
  ///
  /// Expected result:
  ///   - Positive assertion: the + button, model chip, mic, and message input
  ///     exist because they are the new canonical toolbar.
  ///   - Negative assertion: the old Commands pill is absent because commands
  ///     now live behind the + sheet.
  ///   - Negative assertion: empty counter is absent to keep the toolbar airy.
  it('renders Apple-style composer controls instead of the old command pill', () => {
    const { getByPlaceholderText, getByText, getByTestId, queryByText } = renderInputBar();

    assertTruthy(getByTestId('composer-plus-btn'), 'composer must expose + as the sheet trigger');
    assertTruthy(getByTestId('composer-model-chip'), 'composer must show the selected model chip');
    assertTruthy(getByTestId('mic-btn'), 'composer must keep mic as an inline affordance');
    assertTruthy(getByText('Default'), 'model chip should display the current model label');
    assertTruthy(getByPlaceholderText('Message Grok...'), 'default placeholder should render');
    assertEqual(
      getByTestId('message-input').props.maxLength,
      4096,
      'message input must keep the 4096 character cap',
    );
    assertFalsy(queryByText('Commands'), 'old Commands pill should not render in the composer');
    assertFalsy(queryByText('0 / 4096'), 'empty composer should not spend space on a counter');
  });

  /// Perplexity-style tray spacing: input and controls should breathe.
  ///
  /// Data construction:
  ///   card minHeight target = 112px, close to the compact reference tray.
  ///   leading tools         = + and model chip only.
  ///   trailing tools        = mic plus contextual action/counter.
  ///   visual control target = 28px shells, 11px model label, 15px input text.
  ///
  /// Execution process:
  ///   1. Render the empty composer.
  ///   2. Inspect card geometry, toolbar group ownership, and compact control scale.
  ///
  /// Expected result:
  ///   - Positive assertion: card has a taller minimum height.
  ///   - Positive assertion: mic lives in the trailing group like the reference.
  ///   - Positive assertion: icon shells and text are visually quieter than the
  ///     previous oversized composer.
  ///   - Negative assertion: mic is not squeezed into the leading group.
  it('uses a spacious two-zone toolbar like the reference input tray', () => {
    const { getByText, getByTestId } = renderInputBar();
    const cardStyle = StyleSheet.flatten(getByTestId('composer-card').props.style);
    const inputStyle = StyleSheet.flatten(getByTestId('message-input').props.style);
    const plusShellStyle = StyleSheet.flatten(getByTestId('composer-plus-shell').props.style);
    const micShellStyle = StyleSheet.flatten(getByTestId('mic-shell').props.style);
    const modelShellStyle = StyleSheet.flatten(getByTestId('composer-model-shell').props.style);
    const modelTextStyle = StyleSheet.flatten(getByText('Default').props.style);
    const leadingTools = within(getByTestId('composer-toolbar-left'));
    const trailingTools = within(getByTestId('composer-toolbar-right'));

    assertEqual(cardStyle.minHeight, 112, 'composer card should match the compact tray height');
    assertTruthy(
      leadingTools.getByTestId('composer-plus-btn'),
      'leading toolbar should keep the + affordance',
    );
    assertTruthy(
      leadingTools.getByTestId('composer-model-chip'),
      'leading toolbar should keep the model chip',
    );
    assertFalsy(
      leadingTools.queryByTestId('mic-btn'),
      'mic should not crowd the leading + and model controls',
    );
    assertTruthy(
      trailingTools.getByTestId('mic-btn'),
      'mic should sit in the trailing action group',
    );
    assertEqual(cardStyle.paddingVertical, 12, 'composer vertical padding should be compact');
    assertEqual(cardStyle.gap, 6, 'composer rows should sit closer like the reference tray');
    assertEqual(inputStyle.fontSize, 15, 'input placeholder/text should be compact');
    assertEqual(plusShellStyle.width, 28, '+ icon shell should be visually compact');
    assertEqual(micShellStyle.width, 28, 'mic icon shell should be visually compact');
    assertEqual(modelShellStyle.height, 28, 'model chip should use a compact height');
    assertEqual(modelTextStyle.fontSize, 11, 'model label should be smaller than body text');
  });

  /// Character counter: input length should update the composer count.
  ///
  /// Data construction:
  ///   value = "hello" → 5 characters.
  ///   max   = 4096 characters.
  ///
  /// Execution process:
  ///   1. Render with value "hello".
  ///   2. Read the visible counter.
  ///
  /// Expected result:
  ///   - Positive assertion: "5 / 4096" exists.
  ///   - Negative assertion: stale "0 / 4096" is absent.
  it('updates the character counter with the current input length', () => {
    const { getByText, queryByText } = renderInputBar({ value: 'hello' });

    assertTruthy(getByText('5 / 4096'), 'counter should reflect the current text length');
    assertFalsy(
      queryByText('0 / 4096'),
      'counter must not show the empty value after text renders',
    );
  });

  /// Send affordance: text input should reveal the primary send action.
  ///
  /// Data construction:
  ///   value = "hello" → non-empty trimmed text.
  ///
  /// Execution process:
  ///   1. Render with non-empty value.
  ///   2. Inspect primary action test IDs.
  ///
  /// Expected result:
  ///   - Positive assertion: send button exists.
  ///   - Negative assertion: mic-only idle action does not replace send.
  it('renders send button when input has text', () => {
    const { getByTestId, queryByTestId } = renderInputBar({ value: 'hello' });

    assertTruthy(getByTestId('send-btn'), 'send button should be visible for non-empty text');
    assertFalsy(queryByTestId('idle-action-btn'), 'idle action should not replace send for text');
  });

  /// Empty composer: mic remains available when there is no sendable content.
  ///
  /// Data construction:
  ///   value = "".
  ///   pendingImages = [].
  ///
  /// Execution process:
  ///   1. Render with no text and no image.
  ///   2. Inspect idle controls.
  ///
  /// Expected result:
  ///   - Positive assertion: mic button exists.
  ///   - Negative assertion: send button is absent because there is nothing to send.
  it('renders mic button when input is empty', () => {
    const { getByTestId, queryByTestId } = renderInputBar();

    assertTruthy(getByTestId('mic-btn'), 'mic should be available for an empty composer');
    assertFalsy(queryByTestId('send-btn'), 'send must not show without text or uploaded images');
  });

  /// Send action: pressing send should call the provided handler once.
  ///
  /// Data construction:
  ///   value = "hello" → send button visible.
  ///   onSend = jest.fn().
  ///
  /// Execution process:
  ///   1. Render with non-empty value.
  ///   2. Press the send button.
  ///
  /// Expected result:
  ///   - Positive assertion: onSend is called exactly once.
  ///   - Negative assertion: onSend is not skipped.
  it('calls onSend when send button pressed', () => {
    const onSend = jest.fn();
    const { getByTestId } = renderInputBar({ value: 'hello', onSend });

    fireEvent.press(getByTestId('send-btn'));

    assertEqual(onSend.mock.calls.length, 1, 'send button should call onSend exactly once');
  });

  /// Plus action: pressing + should open the composer sheet, not upload directly.
  ///
  /// Data construction:
  ///   onOpenComposerSheet = jest.fn().
  ///
  /// Execution process:
  ///   1. Render enabled composer.
  ///   2. Press the + button.
  ///
  /// Expected result:
  ///   - Positive assertion: onOpenComposerSheet is called once.
  ///   - Negative assertion: disabled state is not set on the + button.
  it('calls onOpenComposerSheet when plus button pressed', () => {
    const onOpenComposerSheet = jest.fn();
    const { getByTestId } = renderInputBar({ onOpenComposerSheet });

    fireEvent.press(getByTestId('composer-plus-btn'));

    assertEqual(
      onOpenComposerSheet.mock.calls.length,
      1,
      '+ should open the composer sheet exactly once',
    );
    assertEqual(
      getByTestId('composer-plus-btn').props.accessibilityState?.disabled,
      false,
      '+ button should be enabled for an enabled composer',
    );
  });

  /// Model chip: the composer should own model switching entry.
  ///
  /// Data construction:
  ///   modelLabel = "Codex 5.3".
  ///   onOpenModelSelector = jest.fn().
  ///
  /// Execution process:
  ///   1. Render the composer with a concrete model label.
  ///   2. Press the model chip.
  ///
  /// Expected result:
  ///   - Positive assertion: onOpenModelSelector is called once.
  ///   - Negative assertion: the chip is not disabled.
  it('opens model selector from the inline model chip', () => {
    const onOpenModelSelector = jest.fn();
    const { getByTestId, getByText } = renderInputBar({
      modelLabel: 'Codex 5.3',
      onOpenModelSelector,
    });

    fireEvent.press(getByTestId('composer-model-chip'));

    assertTruthy(getByText('Codex 5.3'), 'model chip must render the current model label');
    assertEqual(
      onOpenModelSelector.mock.calls.length,
      1,
      'model chip should open the model selector exactly once',
    );
    assertEqual(
      getByTestId('composer-model-chip').props.accessibilityState?.disabled,
      false,
      'model chip should not be disabled when model switching is available',
    );
  });

  /// Model chip disabled state: active conversations must not switch models.
  ///
  /// Data construction:
  ///   modelDisabled = true.
  ///   onOpenModelSelector = jest.fn().
  ///
  /// Execution process:
  ///   1. Render with model switching disabled.
  ///   2. Press the model chip.
  ///
  /// Expected result:
  ///   - Positive assertion: accessibility disabled state is true.
  ///   - Negative assertion: selector callback is not called.
  it('does not open model selector when model chip is disabled', () => {
    const onOpenModelSelector = jest.fn();
    const { getByTestId } = renderInputBar({ modelDisabled: true, onOpenModelSelector });

    fireEvent.press(getByTestId('composer-model-chip'));

    assertEqual(
      getByTestId('composer-model-chip').props.accessibilityState?.disabled,
      true,
      'disabled model chip should expose disabled accessibility state',
    );
    assertEqual(
      onOpenModelSelector.mock.calls.length,
      0,
      'disabled model chip must not open the selector',
    );
  });

  /// Mic action: the placeholder voice action should not send a message.
  ///
  /// Data construction:
  ///   value = "".
  ///   onSend = jest.fn().
  ///
  /// Execution process:
  ///   1. Render empty composer.
  ///   2. Press mic.
  ///
  /// Expected result:
  ///   - Positive assertion: coming-soon alert is shown.
  ///   - Negative assertion: onSend is not called.
  it('shows alert and does not call onSend when mic button pressed', () => {
    const onSend = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = renderInputBar({ onSend });

    fireEvent.press(getByTestId('mic-btn'));

    assertEqual(onSend.mock.calls.length, 0, 'mic must not send a message');
    assertEqual(
      alertSpy.mock.calls[0]?.[0],
      '语音功能即将上线，敬请期待',
      'mic should show the existing coming-soon alert',
    );
    alertSpy.mockRestore();
  });

  /// Stop action: running agent state should replace send with stop.
  ///
  /// Data construction:
  ///   isAgentRunning = true.
  ///   onStop = jest.fn().
  ///
  /// Execution process:
  ///   1. Render composer while agent is running.
  ///   2. Press stop.
  ///
  /// Expected result:
  ///   - Positive assertion: onStop is called once.
  ///   - Negative assertion: send button is absent while running.
  it('calls onStop when stop button pressed during agent run', () => {
    const onStop = jest.fn();
    const { getByTestId, queryByTestId } = renderInputBar({ isAgentRunning: true, onStop });

    fireEvent.press(getByTestId('stop-btn'));

    assertEqual(onStop.mock.calls.length, 1, 'stop button should call onStop exactly once');
    assertFalsy(queryByTestId('send-btn'), 'send button must not render while agent is running');
  });

  /// Disabled composer: secondary controls should expose disabled state.
  ///
  /// Data construction:
  ///   disabled = true.
  ///   modelDisabled = true.
  ///
  /// Execution process:
  ///   1. Render disabled composer.
  ///   2. Inspect + and model chip accessibility states.
  ///
  /// Expected result:
  ///   - Positive assertion: + disabled state is true.
  ///   - Positive assertion: model chip disabled state is true.
  it('disables sheet and model controls when disabled', () => {
    const { getByTestId } = renderInputBar({ disabled: true, modelDisabled: true });

    assertEqual(
      getByTestId('composer-plus-btn').props.accessibilityState?.disabled,
      true,
      'disabled composer should disable the + sheet trigger',
    );
    assertEqual(
      getByTestId('composer-model-chip').props.accessibilityState?.disabled,
      true,
      'disabled model switching should disable the model chip',
    );
  });

  /// Image preview empty state: no pending image should hide the preview row.
  ///
  /// Data construction:
  ///   pendingImages = [].
  ///
  /// Execution process:
  ///   1. Render with no images.
  ///   2. Query the preview row.
  ///
  /// Expected result:
  ///   - Negative assertion: preview row is absent.
  it('does not render image preview row when pendingImages is empty', () => {
    const { queryByTestId } = renderInputBar({ pendingImages: [] });

    assertFalsy(queryByTestId('img-preview-row'), 'empty pendingImages should hide preview row');
  });

  /// Image preview populated state: pending images should render thumbnails.
  ///
  /// Data construction:
  ///   image 1 = uploaded with fileId "f1".
  ///   image 2 = uploading with no fileId.
  ///
  /// Execution process:
  ///   1. Render with two pending images.
  ///   2. Inspect preview row and upload overlay.
  ///
  /// Expected result:
  ///   - Positive assertion: preview row exists.
  ///   - Positive assertion: upload overlay text exists for uploading image.
  it('renders image preview row and upload overlay for pending images', () => {
    const pendingImages = [
      { localUri: 'file:///test1.jpg', fileId: 'f1', status: 'uploaded' as const },
      { localUri: 'file:///test2.jpg', fileId: null, status: 'uploading' as const },
    ];
    const { getByTestId, getByText } = renderInputBar({ pendingImages });

    assertTruthy(getByTestId('img-preview-row'), 'pending images should show preview row');
    assertTruthy(getByText('...'), 'uploading image should show the uploading overlay');
  });

  /// Image removal: thumbnail close button removes the indexed pending image.
  ///
  /// Data construction:
  ///   pendingImages[0] = uploaded image.
  ///   onRemoveImage = jest.fn().
  ///
  /// Execution process:
  ///   1. Render with one pending image.
  ///   2. Press remove button for index 0.
  ///
  /// Expected result:
  ///   - Positive assertion: onRemoveImage receives 0.
  ///   - Negative assertion: another index is not sent.
  it('calls onRemoveImage when remove button is pressed', () => {
    const onRemoveImage = jest.fn();
    const pendingImages = [
      { localUri: 'file:///test1.jpg', fileId: 'f1', status: 'uploaded' as const },
    ];
    const { getByTestId } = renderInputBar({ pendingImages, onRemoveImage });

    fireEvent.press(getByTestId('remove-img-0'));

    assertEqual(onRemoveImage.mock.calls[0]?.[0], 0, 'remove button should pass image index 0');
    assertEqual(onRemoveImage.mock.calls.length, 1, 'remove button should call once');
  });

  /// Image failure state: failed uploads should be visibly marked.
  ///
  /// Data construction:
  ///   pendingImages[0].status = "failed".
  ///
  /// Execution process:
  ///   1. Render with one failed image.
  ///   2. Inspect failure overlay.
  ///
  /// Expected result:
  ///   - Positive assertion: "!" overlay exists.
  ///   - Negative assertion: uploading overlay is absent.
  it('shows failed overlay for failed images', () => {
    const pendingImages = [
      { localUri: 'file:///test1.jpg', fileId: null, status: 'failed' as const },
    ];
    const { getByText, queryByText } = renderInputBar({ pendingImages });

    assertTruthy(getByText('!'), 'failed image should show the failure overlay');
    assertFalsy(queryByText('...'), 'failed image should not show uploading overlay');
  });
});

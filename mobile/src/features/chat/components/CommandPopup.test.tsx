import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import CommandPopup from './CommandPopup';

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

function renderSheet(props: Partial<React.ComponentProps<typeof CommandPopup>> = {}) {
  return render(
    <CommandPopup
      visible={true}
      mode="actions"
      onModeChange={noop}
      onPickImage={noop}
      onSelect={noop}
      onDismiss={noop}
      {...props}
    />,
  );
}

describe('Composer action sheet', () => {
  /// Action sheet initial mode: + should reveal upload and command actions.
  ///
  /// Data construction:
  ///   visible = true.
  ///   mode = "actions".
  ///
  /// Execution process:
  ///   1. Render the sheet in actions mode.
  ///   2. Inspect the grabber, title, and action rows.
  ///
  /// Expected result:
  ///   - Positive assertion: Upload Image and Commands actions exist.
  ///   - Negative assertion: command search is absent until Commands is selected.
  it('renders upload and command actions in actions mode', () => {
    const { getByText, getByTestId, queryByTestId } = renderSheet();

    assertTruthy(getByTestId('composer-sheet-backdrop'), 'sheet should render a dismiss backdrop');
    assertTruthy(getByTestId('composer-sheet-grabber'), 'sheet should render an iOS-style grabber');
    assertTruthy(getByText('Add to message'), 'actions mode should explain the action group');
    assertTruthy(getByText('Upload Image'), 'upload image action should be visible');
    assertTruthy(getByText('Commands'), 'commands action should be visible');
    assertFalsy(
      queryByTestId('command-search-input'),
      'command search should not render before entering command mode',
    );
  });

  /// Upload action: image picking remains behind the + sheet.
  ///
  /// Data construction:
  ///   onPickImage = jest.fn().
  ///
  /// Execution process:
  ///   1. Render actions mode.
  ///   2. Press Upload Image.
  ///
  /// Expected result:
  ///   - Positive assertion: onPickImage is called once.
  ///   - Negative assertion: command mode is not requested.
  it('calls onPickImage when Upload Image is pressed', () => {
    const onPickImage = jest.fn();
    const onModeChange = jest.fn();
    const { getByTestId } = renderSheet({ onPickImage, onModeChange });

    fireEvent.press(getByTestId('composer-action-upload'));

    assertEqual(onPickImage.mock.calls.length, 1, 'Upload Image should call onPickImage once');
    assertEqual(onModeChange.mock.calls.length, 0, 'Upload Image should not enter command mode');
  });

  /// Commands action: commands open inside the same sheet.
  ///
  /// Data construction:
  ///   onModeChange = jest.fn().
  ///
  /// Execution process:
  ///   1. Render actions mode.
  ///   2. Press Commands.
  ///
  /// Expected result:
  ///   - Positive assertion: onModeChange receives "commands".
  ///   - Negative assertion: Upload Image handler is not called.
  it('requests command mode when Commands is pressed', () => {
    const onModeChange = jest.fn();
    const onPickImage = jest.fn();
    const { getByTestId } = renderSheet({ onModeChange, onPickImage });

    fireEvent.press(getByTestId('composer-action-commands'));

    assertEqual(
      onModeChange.mock.calls[0]?.[0],
      'commands',
      'Commands action should switch the same sheet into command mode',
    );
    assertEqual(onPickImage.mock.calls.length, 0, 'Commands action must not pick an image');
  });

  /// Command mode: searchable command list should replace action rows.
  ///
  /// Data construction:
  ///   mode = "commands".
  ///   COMMANDS contains /clear and /reset.
  ///
  /// Execution process:
  ///   1. Render the sheet in command mode.
  ///   2. Inspect command rows and search input.
  ///
  /// Expected result:
  ///   - Positive assertion: command search and known commands exist.
  ///   - Negative assertion: desktop-only ESC hint is absent.
  it('renders searchable command list in command mode', () => {
    const { getByLabelText, getByText, getByTestId, queryByText } = renderSheet({
      mode: 'commands',
    });

    assertTruthy(getByText('Commands'), 'command mode should title the command list');
    assertTruthy(getByLabelText('Search commands'), 'command mode should include search input');
    assertTruthy(getByTestId('command-badge-clear'), 'command list should render /clear badge');
    assertTruthy(getByText('/reset'), 'command list should include /reset');
    assertFalsy(queryByText('ESC to close'), 'iOS sheet must not show desktop keyboard copy');
  });

  /// Command filtering: search query should narrow visible rows.
  ///
  /// Data construction:
  ///   mode = "commands".
  ///   query = "clear".
  ///
  /// Execution process:
  ///   1. Render command mode.
  ///   2. Type "clear" into the search field.
  ///
  /// Expected result:
  ///   - Positive assertion: /clear remains visible.
  ///   - Negative assertion: /reset is hidden by the filter.
  it('filters commands by search query', () => {
    const { getByTestId, getByText, queryByText } = renderSheet({ mode: 'commands' });

    fireEvent.changeText(getByTestId('command-search-input'), 'clear');

    assertTruthy(getByText('/clear'), 'matching /clear command should remain visible');
    assertFalsy(queryByText('/reset'), 'nonmatching /reset command should be filtered out');
  });

  /// Command selection: tapping a row should insert its command string.
  ///
  /// Data construction:
  ///   mode = "commands".
  ///   selected row = /clear.
  ///
  /// Execution process:
  ///   1. Render command mode.
  ///   2. Press /clear.
  ///
  /// Expected result:
  ///   - Positive assertion: onSelect receives "/clear".
  ///   - Negative assertion: onSelect is not called with a label-only value.
  it('calls onSelect with command string when item pressed', () => {
    const onSelect = jest.fn();
    const { getByTestId } = renderSheet({ mode: 'commands', onSelect });

    fireEvent.press(getByTestId('command-item-clear'));

    assertEqual(onSelect.mock.calls[0]?.[0], '/clear', 'command row should return slash command');
    assertEqual(onSelect.mock.calls.length, 1, 'one command row press should call onSelect once');
  });

  /// Backdrop dismissal: tapping outside the sheet should dismiss it.
  ///
  /// Data construction:
  ///   onDismiss = jest.fn().
  ///
  /// Execution process:
  ///   1. Render the visible sheet.
  ///   2. Press the backdrop.
  ///
  /// Expected result:
  ///   - Positive assertion: onDismiss is called once.
  ///   - Negative assertion: no command is selected.
  it('calls onDismiss when backdrop pressed', () => {
    const onDismiss = jest.fn();
    const onSelect = jest.fn();
    const { getByTestId } = renderSheet({ onDismiss, onSelect });

    fireEvent.press(getByTestId('composer-sheet-backdrop'));

    assertEqual(onDismiss.mock.calls.length, 1, 'backdrop should dismiss the sheet once');
    assertEqual(onSelect.mock.calls.length, 0, 'backdrop should not select a command');
  });

  /// Command empty state: unmatched search should show a clear empty result.
  ///
  /// Data construction:
  ///   mode = "commands".
  ///   query = "zzznomatch".
  ///
  /// Execution process:
  ///   1. Render command mode.
  ///   2. Enter a query with no matching command.
  ///
  /// Expected result:
  ///   - Positive assertion: empty state text appears.
  ///   - Negative assertion: /clear is absent.
  it('shows empty state when no commands match filter', () => {
    const { getByTestId, getByText, queryByText } = renderSheet({ mode: 'commands' });

    fireEvent.changeText(getByTestId('command-search-input'), 'zzznomatch');

    assertTruthy(getByText('无匹配命令'), 'empty query result should show no-match copy');
    assertFalsy(queryByText('/clear'), 'nonmatching /clear row should be hidden');
  });

  /// Hidden sheet: invisible state should render no backdrop.
  ///
  /// Data construction:
  ///   visible = false.
  ///
  /// Execution process:
  ///   1. Render the sheet hidden.
  ///   2. Query the backdrop.
  ///
  /// Expected result:
  ///   - Negative assertion: backdrop is absent.
  it('renders nothing when visible=false', () => {
    const { queryByTestId } = renderSheet({ visible: false });

    assertFalsy(
      queryByTestId('composer-sheet-backdrop'),
      'hidden sheet should not render backdrop',
    );
  });
});

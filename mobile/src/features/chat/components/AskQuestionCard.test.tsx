import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import AskQuestionCard from './AskQuestionCard';

const baseOptions = [
  { id: 'a', label: 'Option A' },
  { id: 'b', label: 'Option B' },
];

function assertEqual<T>(actual: T, expected: T, message: string) {
  expect({ actual, reason: message }).toEqual({ actual: expected, reason: expect.any(String) });
}

function assertNotEqual<T>(actual: T, expected: T, message: string) {
  expect({ actual, reason: message }).not.toEqual({
    actual: expected,
    reason: expect.any(String),
  });
}

/// iOS transcript width: a single-question card should fill the same parent
/// width as the currently rendered AI message card instead of keeping the old
/// narrow fixed width.
///
/// Data construction:
///   parent transcript row width = 100% of the chat content column
///   legacy card width           = 320px fixed
///   desired card width          = 100% of parent row
///
/// Execution process:
///   1. Render an unanswered AskQuestionCard with two options.
///   2. Inspect the root card style applied to the rendered card.
///
/// Expected result:
///   - Positive: root card width is "100%", matching the full parent row.
///   - Negative: root card width is not the legacy fixed 320px value.
test('fills the parent transcript width instead of using the legacy fixed width', () => {
  const { toJSON } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  const cardStyle = StyleSheet.flatten(toJSON()?.props.style);

  assertEqual(cardStyle.width, '100%', 'question card should fill its parent transcript row');
  assertNotEqual(cardStyle.width, 320, 'question card must not keep the old fixed 320px width');
});

// T-1: "Other" option always appears at the end of the options list
test('renders Other option at the end of the options list', () => {
  const { getByLabelText } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  // "Other" option is present
  expect(getByLabelText('Other')).toBeTruthy();
  // Original options are still present
  expect(getByLabelText('Option A')).toBeTruthy();
  expect(getByLabelText('Option B')).toBeTruthy();
});

// T-2: Selecting "Other" expands an inline TextInput
test('selecting Other reveals an inline text input', () => {
  const { getByLabelText, queryByPlaceholderText } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  expect(queryByPlaceholderText('Type your answer...')).toBeNull();

  fireEvent.press(getByLabelText('Other'));

  expect(queryByPlaceholderText('Type your answer...')).toBeTruthy();
});

// T-3: Use answer is disabled until the user types something in the Other input
test('Use answer stays disabled until Other input has text', () => {
  const { getByLabelText, getByPlaceholderText } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  fireEvent.press(getByLabelText('Other'));

  const useAnswerBtn = getByLabelText('Use answer');
  expect(useAnswerBtn.props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'my custom answer');

  expect(useAnswerBtn.props.accessibilityState?.disabled).toBe(false);
});

test('Confirm stays disabled while Other input text is uncommitted', () => {
  const { getByLabelText, getByPlaceholderText } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'x');

  expect(getByLabelText('Confirm').props.accessibilityState?.disabled).toBe(true);

  fireEvent.press(getByLabelText('Use answer'));

  expect(getByLabelText('Confirm').props.accessibilityState?.disabled).toBe(false);
});

// T-4: onConfirm receives the typed text when Other is selected (single-select)
test('onConfirm receives typed text when Other is selected in single-select mode', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByPlaceholderText } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'my custom answer');
  fireEvent.press(getByLabelText('Use answer'));
  fireEvent.press(getByLabelText('Confirm'));

  expect(onConfirm).toHaveBeenCalledWith('my custom answer');
});

// T-5: In multi-select mode, Other can be selected alongside other options;
//       onConfirm receives "id1,id2,custom text"
test('onConfirm includes typed text alongside other selected ids in multi-select mode', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByPlaceholderText } = render(
    <AskQuestionCard
      question="Pick many"
      options={baseOptions}
      multiSelect
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(getByLabelText('Option A'));
  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'extra');
  fireEvent.press(getByLabelText('Use answer'));
  fireEvent.press(getByLabelText('Confirm'));

  expect(onConfirm).toHaveBeenCalledWith('a,extra');
});

/// Answer acknowledgement boundary: confirming a single-choice card must not
/// switch the card into answered presentation until the parent message is marked
/// answered after server acknowledgement.
///
/// Data construction:
///   selected option = Option A / id 'a'
///   answered prop before ack = false
///   answered prop after ack  = true
///
/// Execution process:
///   1. Render an unanswered card and select Option A.
///   2. Press Confirm, which calls onConfirm but does not mutate parent props.
///   3. Re-render with answered=true, matching a later successful ack.
///
/// Expected result:
///   - Positive: onConfirm receives 'a', proving the answer was submitted.
///   - Negative: ANSWERED is absent before the parent ack state arrives.
///   - Positive: ANSWERED appears after the parent passes answered=true.
test('waits for answered prop before showing answered state', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByText, queryByText, rerender } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(getByLabelText('Option A'));
  fireEvent.press(getByLabelText('Confirm'));

  expect({
    actual: onConfirm.mock.calls.some(([value]) => value === 'a'),
    reason: 'Confirm should submit selected option id while waiting for server ack',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: queryByText('AGENT IS ASKING') != null,
    reason: 'card should remain in asking state until parent answered prop changes',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: queryByText('ANSWERED'),
    reason: 'card must not show ANSWERED before successful acknowledgement',
  }).toEqual({ actual: null, reason: expect.any(String) });

  rerender(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      answered
      initialSelectedId="a"
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  expect({
    actual: getByText('ANSWERED') != null,
    reason: 'card should show ANSWERED after parent passes answered=true',
  }).toEqual({ actual: true, reason: expect.any(String) });
});

// ─── Round-trip contract with CLI build_ask_payload ─────────────────────────
//
// CLI build_ask_payload assigns numeric string ids to options: "0", "1", "2"...
// Mobile AskQuestionCard receives these ids and must pass them back via onConfirm.
// This section tests that contract end-to-end within the Mobile layer.
//
// Data construction:
//   options = [{ id: '0', label: 'Option A' }, { id: '1', label: 'Option B' }]
//   These mirror what CLI build_ask_payload produces for any AskUserQuestion call.

const numericIdOptions = [
  { id: '0', label: 'Option A' },
  { id: '1', label: 'Option B' },
  { id: '2', label: 'Option C' },
];

/// T-contract-1: Selecting a numeric-id option must pass that numeric id string
/// to onConfirm, not the option label.
///
/// This is the critical contract between Mobile and CLI:
///   CLI assigns option.id = "1" (array index)
///   Mobile must call onConfirm("1") so CLI can look up options[1].label
///
/// If onConfirm received "Option B" instead of "1", the CLI would get
/// choice_id = "Option B" (non-numeric) and use it verbatim as the answer,
/// bypassing the label lookup and producing correct-ish answers only by coincidence.
test('onConfirm passes numeric option id (not label) when user picks a numeric-id option', () => {
  const onConfirm = jest.fn();
  const { getByLabelText } = render(
    <AskQuestionCard
      question="Pick one"
      options={numericIdOptions}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(getByLabelText('Option B'));
  fireEvent.press(getByLabelText('Confirm'));

  assertEqual(
    onConfirm.mock.calls.some(([value]) => value === '1'),
    true,
    "onConfirm must receive the numeric id '1' (not label 'Option B') for the CLI round-trip to work",
  );
  assertNotEqual(
    onConfirm.mock.calls.some(([value]) => value === 'Option B'),
    true,
    "onConfirm must NOT receive the label 'Option B' — CLI expects numeric index ids",
  );
});

/// T-contract-2: Selecting the first option (id "0") must pass "0" to onConfirm.
///
/// This is important because "0" is falsy-ish in JS but must still be transmitted.
test('onConfirm passes "0" for first option with numeric id 0', () => {
  const onConfirm = jest.fn();
  const { getByLabelText } = render(
    <AskQuestionCard
      question="Pick one"
      options={numericIdOptions}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(getByLabelText('Option A'));
  fireEvent.press(getByLabelText('Confirm'));

  assertEqual(
    onConfirm.mock.calls.some(([value]) => value === '0'),
    true,
    "onConfirm must pass id '0' for first option — falsy string '0' must not be dropped",
  );
});

/// T-contract-3: Multi-select with numeric ids must pass comma-joined numeric ids.
///
/// CLI build_updated_input expects choice_ids = {"0": "0,2"} (joined option indices).
/// MessageBubble wraps this as: onAnswerMulti(ask_id, { '0': ids })
/// where ids = onConfirm result = "0,2" (sorted numeric ids, no custom).
test('multi-select onConfirm passes comma-joined numeric ids in sorted order', () => {
  const onConfirm = jest.fn();
  const { getByLabelText } = render(
    <AskQuestionCard
      question="Pick many"
      options={numericIdOptions}
      multiSelect
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  // Select option C (id "2") first, then option A (id "0")
  fireEvent.press(getByLabelText('Option C'));
  fireEvent.press(getByLabelText('Option A'));
  fireEvent.press(getByLabelText('Confirm'));

  assertEqual(
    onConfirm.mock.calls.some(([value]) => value === '0,2'),
    true,
    "multi-select onConfirm must pass comma-joined sorted ids '0,2' for CLI to map back to labels",
  );
});

/// Answered custom answer rendering: a custom text answer should remain visible
/// when the parent later marks the card answered.
///
/// Data construction:
///   Other text = 'my custom answer'
///   answered prop flips false → true after Confirm
///
/// Execution process:
///   1. Select Other, type the custom answer, and commit it with Use.
///   2. Confirm while answered=false.
///   3. Re-render with answered=true to model successful server ack.
///
/// Expected result:
///   - Positive: onConfirm receives the custom text.
///   - Positive: custom text is visible in answered presentation after ack.
test('answered state shows the typed text for Other selection after ack', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByPlaceholderText, getByText, rerender } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'my custom answer');
  fireEvent.press(getByLabelText('Use answer'));
  fireEvent.press(getByLabelText('Confirm'));

  expect({
    actual: onConfirm.mock.calls.some(([value]) => value === 'my custom answer'),
    reason: 'Confirm should submit custom Other text',
  }).toEqual({ actual: true, reason: expect.any(String) });

  rerender(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      answered
      initialSelectedId="my custom answer"
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  expect({
    actual: getByText('my custom answer') != null,
    reason: 'answered presentation should preserve visible custom Other text after ack',
  }).toEqual({ actual: true, reason: expect.any(String) });
});

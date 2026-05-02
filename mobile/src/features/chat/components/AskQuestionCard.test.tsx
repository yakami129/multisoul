import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import AskQuestionCard from './AskQuestionCard';

const baseOptions = [
  { id: 'a', label: 'Option A' },
  { id: 'b', label: 'Option B' },
];

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

// T-6: After answering with Other, the card shows the typed text (not "Other")
test('answered state shows the typed text for Other selection', () => {
  const { getByLabelText, getByPlaceholderText, getByText } = render(
    <AskQuestionCard
      question="Pick one"
      options={baseOptions}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'my custom answer');
  fireEvent.press(getByLabelText('Use answer'));
  fireEvent.press(getByLabelText('Confirm'));

  expect(getByText('my custom answer')).toBeTruthy();
});

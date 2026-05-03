import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import MultiAskQuestionCard from './MultiAskQuestionCard';

const baseQuestions = [
  {
    id: 'q1',
    text: 'First question',
    options: [
      { id: 'a', label: 'Option A' },
      { id: 'b', label: 'Option B' },
    ],
  },
  {
    id: 'q2',
    text: 'Second question',
    options: [
      { id: 'c', label: 'Option C' },
      { id: 'd', label: 'Option D' },
    ],
  },
];

// T-1: Each active question renders an "Other" option at the end
test('active question renders Other option at the end', () => {
  const { getAllByLabelText } = render(
    <MultiAskQuestionCard questions={baseQuestions} onCancel={jest.fn()} onConfirm={jest.fn()} />,
  );

  // Only the first question is active initially
  const otherButtons = getAllByLabelText('Other');
  expect(otherButtons).toHaveLength(1);
});

// T-2: Selecting Other on a question reveals an inline TextInput for that question
test('selecting Other on active question reveals inline text input', () => {
  const { getByLabelText, queryByPlaceholderText } = render(
    <MultiAskQuestionCard questions={baseQuestions} onCancel={jest.fn()} onConfirm={jest.fn()} />,
  );

  expect(queryByPlaceholderText('Type your answer...')).toBeNull();

  fireEvent.press(getByLabelText('Other'));

  expect(queryByPlaceholderText('Type your answer...')).toBeTruthy();
});

// T-3: Committing Other input and moving to next question stores the typed text as the answer
//
// Flow:
//   Q1: select Other → type "custom1" → Use answer → Q2 becomes active
//   Q2: select Option C → all answered → Confirm
//
// Expected: onConfirm receives { q1: 'custom1', q2: 'c' }
test('onConfirm receives typed text for Other selection in multi-question card', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByPlaceholderText } = render(
    <MultiAskQuestionCard questions={baseQuestions} onCancel={jest.fn()} onConfirm={onConfirm} />,
  );

  // Answer Q1 with custom text
  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'custom1');
  fireEvent.press(getByLabelText('Use answer'));

  // Answer Q2
  fireEvent.press(getByLabelText('Option C'));

  fireEvent.press(getByLabelText('Confirm'));

  expect(onConfirm).toHaveBeenCalledWith({ q1: 'custom1', q2: 'c' });
});

// T-4: Answered state shows typed text for Other selection
test('answered state shows typed text for Other selection', () => {
  const { getByLabelText, getByPlaceholderText, getByText } = render(
    <MultiAskQuestionCard
      questions={[baseQuestions[0]]}
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

test('unsubmitted multi-question answers can be edited before final confirm', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByPlaceholderText } = render(
    <MultiAskQuestionCard questions={baseQuestions} onCancel={jest.fn()} onConfirm={onConfirm} />,
  );

  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'custom1');
  fireEvent.press(getByLabelText('Use answer'));

  fireEvent.press(getByLabelText('Edit q1'));
  fireEvent.press(getByLabelText('Option B'));
  fireEvent.press(getByLabelText('Option C'));
  fireEvent.press(getByLabelText('Confirm'));

  expect(onConfirm).toHaveBeenCalledWith({ q1: 'b', q2: 'c' });
});

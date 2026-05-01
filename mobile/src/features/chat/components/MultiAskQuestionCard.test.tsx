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

// T-3: Typing in Other input and moving to next question stores the typed text as the answer
//
// Flow:
//   Q1: select Other → type "custom1" → Q2 becomes active
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
  // Selecting Other with text should advance to Q2 (same as selecting a normal option)
  // We need to "commit" the answer — pressing Other again or pressing a separate confirm-step
  // Per design: typing text counts as selecting; the card advances when text is non-empty and user taps another option or the answer is committed
  // Actually per our design: the answer is stored on text change, advancing happens when user selects any option (including Other with text)
  // Let's simulate: user typed text, now Q2 should be active (answer stored)
  // The card advances to next question once an answer is recorded for current question
  // For Other: answer is recorded when text is non-empty (same as selecting a radio)

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
  fireEvent.press(getByLabelText('Confirm'));

  expect(getByText('my custom answer')).toBeTruthy();
});

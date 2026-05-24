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

/// Answer acknowledgement boundary: confirming a multi-question card must not
/// switch into answered presentation until the parent message receives a
/// successful server acknowledgement.
///
/// Data construction:
///   q1 answer = 'a'
///   q2 answer = 'c'
///   answered prop before ack = false
///   answered prop after ack  = true
///
/// Execution process:
///   1. Render an unanswered card and answer both questions.
///   2. Press Confirm, which calls onConfirm but does not mutate parent props.
///   3. Re-render with answered=true and the same answer map.
///
/// Expected result:
///   - Positive: onConfirm receives both answers.
///   - Negative: ANSWERED is absent before the parent ack state arrives.
///   - Positive: ANSWERED appears after the parent passes answered=true.
test('waits for answered prop before showing answered state', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByText, queryByText, rerender } = render(
    <MultiAskQuestionCard questions={baseQuestions} onCancel={jest.fn()} onConfirm={onConfirm} />,
  );

  fireEvent.press(getByLabelText('Option A'));
  fireEvent.press(getByLabelText('Option C'));
  fireEvent.press(getByLabelText('Confirm'));

  expect({
    actual: onConfirm.mock.calls.some(([value]) => value.q1 === 'a' && value.q2 === 'c'),
    reason: 'Confirm should submit all selected answers while waiting for server ack',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: queryByText('AGENT IS ASKING') != null,
    reason: 'multi-question card should remain in asking state until parent answered prop changes',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: queryByText('ANSWERED'),
    reason: 'multi-question card must not show ANSWERED before successful acknowledgement',
  }).toEqual({ actual: null, reason: expect.any(String) });

  rerender(
    <MultiAskQuestionCard
      questions={baseQuestions}
      answered
      initialAnswers={{ q1: 'a', q2: 'c' }}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  expect({
    actual: getByText('ANSWERED') != null,
    reason: 'multi-question card should show ANSWERED after parent passes answered=true',
  }).toEqual({ actual: true, reason: expect.any(String) });
});

/// Answered custom answer rendering: a custom text answer should remain visible
/// when the parent later marks the multi-question card answered.
///
/// Data construction:
///   q1 Other text = 'my custom answer'
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
test('answered state shows typed text for Other selection after ack', () => {
  const onConfirm = jest.fn();
  const { getByLabelText, getByPlaceholderText, getByText, rerender } = render(
    <MultiAskQuestionCard
      questions={[baseQuestions[0]]}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(getByLabelText('Other'));
  fireEvent.changeText(getByPlaceholderText('Type your answer...'), 'my custom answer');
  fireEvent.press(getByLabelText('Use answer'));
  fireEvent.press(getByLabelText('Confirm'));

  expect({
    actual: onConfirm.mock.calls.some(([value]) => value.q1 === 'my custom answer'),
    reason: 'Confirm should submit custom Other text in the answer map',
  }).toEqual({ actual: true, reason: expect.any(String) });

  rerender(
    <MultiAskQuestionCard
      questions={[baseQuestions[0]]}
      answered
      initialAnswers={{ q1: 'my custom answer' }}
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  expect({
    actual: getByText('my custom answer') != null,
    reason: 'answered presentation should preserve visible custom Other text after ack',
  }).toEqual({ actual: true, reason: expect.any(String) });
});

describe('MultiAskQuestionCard - Multi-select support', () => {
  it('should render checkbox for multi-select question', () => {
    const questions = [
      {
        id: '0',
        text: 'Select frameworks',
        options: [
          { id: '0', label: 'React' },
          { id: '1', label: 'Vue' },
          { id: '2', label: 'Angular' },
        ],
        multi_select: true,
      },
    ];

    const { getByText } = render(
      <MultiAskQuestionCard questions={questions} onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );

    expect(getByText('Select frameworks')).toBeTruthy();
    expect(getByText('React')).toBeTruthy();
  });

  it('should toggle options in multi-select question', () => {
    const questions = [
      {
        id: '0',
        text: 'Select frameworks',
        options: [
          { id: '0', label: 'React' },
          { id: '1', label: 'Vue' },
        ],
        multi_select: true,
      },
    ];

    const onConfirm = jest.fn();
    const { getByText, getByRole } = render(
      <MultiAskQuestionCard questions={questions} onCancel={jest.fn()} onConfirm={onConfirm} />,
    );

    // Select React
    fireEvent.press(getByText('React'));

    // Select Vue
    fireEvent.press(getByText('Vue'));

    // Confirm
    fireEvent.press(getByRole('button', { name: /confirm/i }));

    expect(onConfirm).toHaveBeenCalledWith({ '0': '0,1' });
  });

  it('should deselect option when clicked again in multi-select', () => {
    const questions = [
      {
        id: '0',
        text: 'Select frameworks',
        options: [
          { id: '0', label: 'React' },
          { id: '1', label: 'Vue' },
        ],
        multi_select: true,
      },
    ];

    const onConfirm = jest.fn();
    const { getByText, getByRole } = render(
      <MultiAskQuestionCard questions={questions} onCancel={jest.fn()} onConfirm={onConfirm} />,
    );

    // Select React
    fireEvent.press(getByText('React'));

    // Select Vue
    fireEvent.press(getByText('Vue'));

    // Deselect React
    fireEvent.press(getByText('React'));

    // Confirm
    fireEvent.press(getByRole('button', { name: /confirm/i }));

    expect(onConfirm).toHaveBeenCalledWith({ '0': '1' });
  });
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

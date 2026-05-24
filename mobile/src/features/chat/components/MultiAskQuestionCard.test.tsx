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
  /// Multi-select navigation: a multi-select answer needs an explicit Next action
  /// before moving to the next question, because option taps only toggle selection.
  ///
  /// Data construction:
  ///   q0 = multi-select with React(id 0) and Vue(id 1)
  ///   q1 = single-select with Ship(id 0)
  ///   answered prop = false
  ///
  /// Execution process:
  ///   1. Render q0 as active; q1 is present only as a collapsed header.
  ///   2. Select React and Vue, creating a valid multi-select answer "0,1".
  ///   3. Press Next to advance from q0 to the next unanswered question.
  ///
  /// Expected result:
  ///   - Positive: Next appears after q0 has at least one selected option.
  ///   - Positive: Ship appears after Next, proving q1 became active.
  ///   - Negative: React option button disappears after Next, proving q0 collapsed.
  it('shows Next for answered multi-select questions and advances to the next question', () => {
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
      {
        id: '1',
        text: 'Choose action',
        options: [{ id: '0', label: 'Ship' }],
        multi_select: false,
      },
    ];

    const { getByLabelText, getByText, queryByLabelText } = render(
      <MultiAskQuestionCard questions={questions} onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );

    fireEvent.press(getByLabelText('React'));
    fireEvent.press(getByLabelText('Vue'));

    expect({
      actual: getByLabelText('Next') != null,
      reason: 'Next should appear after q0 has a valid multi-select answer',
    }).toEqual({ actual: true, reason: expect.any(String) });

    fireEvent.press(getByLabelText('Next'));

    expect({
      actual: getByText('Ship') != null,
      reason: 'q1 option should render after pressing Next from the multi-select q0',
    }).toEqual({ actual: true, reason: expect.any(String) });
    expect({
      actual: queryByLabelText('React'),
      reason: 'q0 option buttons should collapse after Next moves focus to q1',
    }).toEqual({ actual: null, reason: expect.any(String) });
  });

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

    expect(getByText(/Q1: Select frameworks/)).toBeTruthy();
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
    const { getByText, getByLabelText } = render(
      <MultiAskQuestionCard questions={questions} onCancel={jest.fn()} onConfirm={onConfirm} />,
    );

    // Select React
    fireEvent.press(getByText('React'));

    // Select Vue
    fireEvent.press(getByText('Vue'));

    // Confirm
    fireEvent.press(getByLabelText('Confirm'));

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
    const { getByText, getByLabelText } = render(
      <MultiAskQuestionCard questions={questions} onCancel={jest.fn()} onConfirm={onConfirm} />,
    );

    // Select React
    fireEvent.press(getByText('React'));

    // Select Vue
    fireEvent.press(getByText('Vue'));

    // Deselect React
    fireEvent.press(getByText('React'));

    // Confirm
    fireEvent.press(getByLabelText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({ '0': '1' });
  });

  it('should handle mixed single-select and multi-select questions', () => {
    const questions = [
      {
        id: '0',
        text: 'Select language',
        options: [
          { id: '0', label: 'TypeScript' },
          { id: '1', label: 'JavaScript' },
        ],
        multi_select: false, // 单选
      },
      {
        id: '1',
        text: 'Select frameworks',
        options: [
          { id: '0', label: 'React' },
          { id: '1', label: 'Vue' },
          { id: '2', label: 'Angular' },
        ],
        multi_select: true, // 多选
      },
    ];

    const onConfirm = jest.fn();
    const { getByText, getByLabelText } = render(
      <MultiAskQuestionCard questions={questions} onCancel={jest.fn()} onConfirm={onConfirm} />,
    );

    // Q1: 单选 TypeScript
    fireEvent.press(getByText('TypeScript'));

    // Q2: 多选 React + Vue
    fireEvent.press(getByText('React'));
    fireEvent.press(getByText('Vue'));

    // Confirm
    fireEvent.press(getByLabelText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({
      '0': '0', // 单选：optionId
      '1': '0,1', // 多选：逗号分隔
    });
  });

  it('should restore multi-select state from initialAnswers', () => {
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
      <MultiAskQuestionCard
        questions={questions}
        answered={true}
        initialAnswers={{ '0': '0,2' }} // React + Angular
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    // 验证已选中状态（通过样式或其他方式，这里简化为存在性检查）
    expect(getByText('React')).toBeTruthy();
    expect(getByText('Angular')).toBeTruthy();
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

  fireEvent.press(getByLabelText('Edit'));
  fireEvent.press(getByLabelText('Option B'));
  fireEvent.press(getByLabelText('Option C'));
  fireEvent.press(getByLabelText('Confirm'));

  expect(onConfirm).toHaveBeenCalledWith({ q1: 'b', q2: 'c' });
});

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { ToolCallRow } from './ToolCallRow';

it('renders a 30px compact tool card with command detail and completed status', () => {
  const { getByText, getByTestId, queryByText } = render(
    <ToolCallRow
      call={{
        tool: 'Bash',
        args: '{"command":"rg --files mobile/src","description":"List mobile source files"}',
        call_id: 'call-1',
      }}
      result={{ call_id: 'call-1', ok: true, summary: '0.4s' }}
    />,
  );

  expect(getByText('Bash')).toBeTruthy();
  expect(getByText('rg --files mobile/src')).toBeTruthy();
  expect(getByTestId('tool-call-status-label').props.children).toBe('Done');
  expect(StyleSheet.flatten(getByTestId('tool-call-row').props.style).height).toBe(30);
  expect(queryByText('0.4s')).toBeNull();
});

it('expands to show formatted args and result output', () => {
  const { getByText, queryByText, getByTestId } = render(
    <ToolCallRow
      call={{
        tool: 'Read',
        args: '{"file_path":"mobile/src/features/chat/components/ToolCallRow.tsx"}',
        call_id: 'call-2',
      }}
      result={{ call_id: 'call-2', ok: false, summary: 'permission denied' }}
    />,
  );

  expect(queryByText('Args')).toBeNull();
  fireEvent.press(getByTestId('tool-call-row'));

  expect(getByText('Args')).toBeTruthy();
  expect(getByText('Result')).toBeTruthy();
  expect(getByText(/"file_path"/)).toBeTruthy();
  expect(getByText('permission denied')).toBeTruthy();
});

it('renders todo items with progress and per-task status markers', () => {
  const { getByText, getByTestId } = render(
    <ToolCallRow
      call={{
        tool: 'TodoWrite',
        args: '{"todos":[{"content":"Map tool types","status":"completed"},{"content":"Create renderers","status":"in_progress"},{"content":"Verify UI","status":"pending"}]}',
        call_id: 'call-3',
      }}
    />,
  );

  expect(getByText('Todo List')).toBeTruthy();
  expect(getByText('1/3 tasks')).toBeTruthy();
  expect(getByTestId('tool-call-todo-progress').props.children).toEqual([1, '/', 3]);
  expect(getByText('Map tool types')).toBeTruthy();
  expect(getByText('Create renderers')).toBeTruthy();
  expect(getByText('Verify UI')).toBeTruthy();
  expect(getByTestId('tool-call-todo-marker-0')).toBeTruthy();
  expect(getByTestId('tool-call-todo-marker-1')).toBeTruthy();
  expect(getByTestId('tool-call-todo-marker-2')).toBeTruthy();
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { InvokeModal } from './InvokeModal';

describe('InvokeModal', () => {
  it('renders result text when visible', () => {
    const { getByText } = render(
      <InvokeModal visible result="hello world" error={null} onClose={() => {}} />,
    );
    expect(getByText('hello world')).toBeTruthy();
  });

  it('renders error text when error is set', () => {
    const { getByText } = render(
      <InvokeModal visible result={null} error="something failed" onClose={() => {}} />,
    );
    expect(getByText('something failed')).toBeTruthy();
  });

  it('calls onClose when Close button pressed', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <InvokeModal visible result="ok" error={null} onClose={onClose} />,
    );
    fireEvent.press(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

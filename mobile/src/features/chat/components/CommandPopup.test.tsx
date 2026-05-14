import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import CommandPopup from './CommandPopup';

const noop = () => {};

describe('CommandPopup', () => {
  it('renders command palette chrome from the pencli reference', () => {
    const { getByLabelText, getByText, getByTestId } = render(
      <CommandPopup visible={true} onSelect={noop} onDismiss={noop} />,
    );

    expect(getByText('Commands')).toBeTruthy();
    expect(getByText('ESC to close')).toBeTruthy();
    expect(getByLabelText('Search commands')).toBeTruthy();
    expect(getByTestId('command-badge-clear')).toBeTruthy();
    expect(getByTestId('command-chevron-clear')).toBeTruthy();
  });

  it('renders all 5 commands when visible', () => {
    const { getByText } = render(<CommandPopup visible={true} onSelect={noop} onDismiss={noop} />);
    expect(getByText('/clear')).toBeTruthy();
    expect(getByText('/reset')).toBeTruthy();
    expect(getByText('/new')).toBeTruthy();
    expect(getByText('/help')).toBeTruthy();
    expect(getByText('/status')).toBeTruthy();
  });

  it('filters commands by search query', () => {
    const { getByTestId, getByText, queryByText } = render(
      <CommandPopup visible={true} onSelect={noop} onDismiss={noop} />,
    );
    fireEvent.changeText(getByTestId('command-search-input'), 'clear');
    expect(getByText('/clear')).toBeTruthy();
    expect(queryByText('/reset')).toBeNull();
  });

  it('calls onSelect with command string when item pressed', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <CommandPopup visible={true} onSelect={onSelect} onDismiss={noop} />,
    );
    fireEvent.press(getByTestId('command-item-clear'));
    expect(onSelect).toHaveBeenCalledWith('/clear');
  });

  it('calls onDismiss when backdrop pressed', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <CommandPopup visible={true} onSelect={noop} onDismiss={onDismiss} />,
    );
    fireEvent.press(getByTestId('command-popup-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no commands match filter', () => {
    const { getByTestId, getByText } = render(
      <CommandPopup visible={true} onSelect={noop} onDismiss={noop} />,
    );
    fireEvent.changeText(getByTestId('command-search-input'), 'zzznomatch');
    expect(getByText('无匹配命令')).toBeTruthy();
  });

  it('renders nothing when visible=false', () => {
    const { queryByTestId } = render(
      <CommandPopup visible={false} onSelect={noop} onDismiss={noop} />,
    );
    expect(queryByTestId('command-popup-backdrop')).toBeNull();
  });

  it('resets search query after selecting a command', () => {
    const onSelect = jest.fn();
    const { getByTestId, getByText, queryByText } = render(
      <CommandPopup visible={true} onSelect={onSelect} onDismiss={noop} />,
    );
    // Type a search query that filters to only /clear
    fireEvent.changeText(getByTestId('command-search-input'), 'clear');
    expect(queryByText('/reset')).toBeNull();
    // Select the filtered command
    fireEvent.press(getByTestId('command-item-clear'));
    expect(onSelect).toHaveBeenCalledWith('/clear');
    // After selection, query is reset — /reset should be visible again
    expect(getByText('/reset')).toBeTruthy();
  });
});

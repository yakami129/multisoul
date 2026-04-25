import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Button } from '../../components/ui/Button';

describe('Button', () => {
  it('renders label text', () => {
    render(<Button label="Save" onPress={() => {}} />);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows loading text when loading', () => {
    render(<Button label="Save" onPress={() => {}} loading loadingLabel="Saving..." />);
    expect(screen.getByText('Saving...')).toBeTruthy();
  });
});

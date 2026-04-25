import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Badge } from '../../components/ui/Badge';

describe('Badge', () => {
  it('renders active status with correct text', () => {
    render(<Badge status="active" />);
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('renders error status', () => {
    render(<Badge status="error" />);
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('renders inactive status', () => {
    render(<Badge status="inactive" />);
    expect(screen.getByText('inactive')).toBeTruthy();
  });
});

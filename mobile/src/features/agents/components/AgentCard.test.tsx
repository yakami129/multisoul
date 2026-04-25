import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AgentCard } from './AgentCard';
import { Agent } from '@/types';

const agent: Agent = {
  id: 'a1',
  name: 'My Agent',
  status: 'active',
  endpoint: 'http://localhost:9000',
  description: 'A test agent',
};

describe('AgentCard', () => {
  it('renders agent name and endpoint', () => {
    const { getByText } = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);
    expect(getByText('My Agent')).toBeTruthy();
    expect(getByText('http://localhost:9000')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<AgentCard agent={agent} onPress={onPress} index={0} />);
    fireEvent.press(getByText('My Agent'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

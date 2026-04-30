import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { type Agent } from '@/types';
import { AgentCard } from './AgentCard';

const agent: Agent = {
  id: 'a1',
  name: 'My Agent',
  project_path: '/home/user/project',
  runtime: 'claude-code',
  created_at: 0,
  endpoint_id: 'ep-1',
  endpoint_label: 'Local',
};

describe('AgentCard', () => {
  it('renders agent name and endpoint', () => {
    const { getByText } = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);
    expect(getByText('MY AGENT')).toBeTruthy();
    expect(getByText('/home/user/project')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<AgentCard agent={agent} onPress={onPress} index={0} />);
    fireEvent.press(getByText('MY AGENT'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

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
  it('renders project name, status, and runtime', () => {
    const { getByText, queryByText } = render(
      <AgentCard agent={agent} onPress={() => {}} index={0} statusLabel="Running" isActive />,
    );
    expect(getByText('My Agent')).toBeTruthy();
    expect(getByText('Running · Claude Code')).toBeTruthy();
    expect(queryByText('/home/user/project')).toBeNull();
    expect(queryByText('LOCAL')).toBeNull();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<AgentCard agent={agent} onPress={onPress} index={0} />);
    fireEvent.press(getByText('My Agent'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

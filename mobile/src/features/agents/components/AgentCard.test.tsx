import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders machine meta and compact project path for fleet rows', () => {
    jest.spyOn(Date, 'now').mockReturnValue(121_000);

    const { getByText, queryByText } = render(
      <AgentCard
        agent={{ ...agent, endpoint_label: 'mac-home', created_at: 1 }}
        onPress={() => {}}
        index={0}
        statusLabel="Idle"
      />,
    );

    expect(getByText('My Agent')).toBeTruthy();
    expect(getByText('mac-home · 2m ago')).toBeTruthy();
    expect(getByText('~/project')).toBeTruthy();
    expect(getByText('Idle')).toBeTruthy();
    expect(queryByText('Idle · Claude Code')).toBeNull();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<AgentCard agent={agent} onPress={onPress} index={0} />);

    fireEvent.press(getByText('My Agent'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('uses stable native flex geometry for the cream fleet row', () => {
    const { getByTestId } = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);

    const row = getByTestId('project-row');
    const rowStyle = StyleSheet.flatten(row.props.style);
    const avatarStyle = StyleSheet.flatten(getByTestId('project-avatar').props.style);
    const bodyStyle = StyleSheet.flatten(getByTestId('project-body').props.style);
    const moreStyle = StyleSheet.flatten(getByTestId('project-chevron').props.style);

    expect(typeof row.props.style).toBe('object');
    expect(rowStyle.flexDirection).toBe('row');
    expect(rowStyle.minHeight).toBe(88);
    expect(rowStyle.borderRadius).toBe(26);
    expect(avatarStyle.width).toBe(40);
    expect(avatarStyle.height).toBe(40);
    expect(avatarStyle.borderRadius).toBe(12);
    expect(avatarStyle.backgroundColor).toBe('#C6FF00');
    expect(bodyStyle.flex).toBe(1);
    expect(moreStyle.width).toBe(34);
  });

  it('maps supported runtimes to prototype tile colors', () => {
    const claudeRender = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);
    const claudeAvatarStyle = StyleSheet.flatten(
      claudeRender.getByTestId('project-avatar').props.style,
    );
    claudeRender.unmount();

    const codexRender = render(
      <AgentCard agent={{ ...agent, runtime: 'codex' }} onPress={() => {}} index={0} />,
    );
    const codexAvatarStyle = StyleSheet.flatten(
      codexRender.getByTestId('project-avatar').props.style,
    );
    codexRender.unmount();

    const cursorRender = render(
      <AgentCard agent={{ ...agent, runtime: 'cursor-cli' }} onPress={() => {}} index={0} />,
    );
    const cursorAvatarStyle = StyleSheet.flatten(
      cursorRender.getByTestId('project-avatar').props.style,
    );

    expect(claudeAvatarStyle.backgroundColor).toBe('#C6FF00');
    expect(codexAvatarStyle.backgroundColor).toBe('#00E5FF');
    expect(cursorAvatarStyle.backgroundColor).toBe('#B7C9AE');
  });

  it('renders status tones for running and pending projects', () => {
    const running = render(
      <AgentCard agent={agent} onPress={() => {}} statusLabel="Running" isActive />,
    );
    expect(running.getByText('Running')).toBeTruthy();
    running.unmount();

    const pending = render(
      <AgentCard
        agent={agent}
        onPress={() => {}}
        statusLabel="Running · Awaiting answer"
        pendingCount={2}
        isActive
      />,
    );
    expect(pending.getByText('Needs Decision 2')).toBeTruthy();
  });

  it('renders breathing chrome only when explicitly opted in', () => {
    const idle = render(<AgentCard agent={agent} onPress={() => {}} isActive />);
    expect(idle.queryByTestId('running-agent-breath')).toBeNull();
    idle.unmount();

    const running = render(
      <AgentCard
        agent={{ ...agent, runtime: 'codex' }}
        onPress={() => {}}
        statusLabel="Running"
        isActive
        showBreathingEffect
      />,
    );

    expect(running.getByTestId('running-agent-breath')).toBeTruthy();
    expect(running.getByText('My Agent')).toBeTruthy();
  });
});

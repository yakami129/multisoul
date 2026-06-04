import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { type Agent } from '@/types';
import { AgentCard } from './AgentCard';
import codexIcon from '../../../../assets/agent-icons/blue-cloud-robot-transparent.png';
import cursorIcon from '../../../../assets/agent-icons/orange-octopus-robot-transparent.png';
import claudeCodeIcon from '../../../../assets/agent-icons/orange-pixel-robot-transparent.png';

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
    expect(rowStyle.minHeight).toBe(62);
    expect(rowStyle.borderRadius).toBe(18);
    expect(avatarStyle.width).toBe(30);
    expect(avatarStyle.height).toBe(30);
    expect(avatarStyle.borderRadius).toBe(9);
    expect(avatarStyle.backgroundColor).toBe('#C6FF00');
    expect(bodyStyle.flex).toBe(1);
    expect(moreStyle.width).toBe(28);
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

  /// Runtime PNG icons: supported runtimes must render the generated asset icons
  ///
  /// Data construction:
  ///   claude-code runtime = orange-pixel-robot-transparent.png
  ///   codex runtime       = blue-cloud-robot-transparent.png
  ///   cursor-cli runtime  = orange-octopus-robot-transparent.png
  ///   custom runtime      = no fixed PNG; it should keep the fallback vector avatar
  ///
  /// Execution:
  ///   1. Render one AgentCard for each supported runtime.
  ///   2. Read the Image source from testID="project-avatar-image".
  ///   3. Render a custom runtime card and verify no runtime Image is mounted.
  ///
  /// Expected:
  ///   - claude-code uses the orange pixel robot PNG.
  ///   - codex uses the blue cloud robot PNG.
  ///   - cursor-cli uses the orange octopus robot PNG.
  ///   - custom does not render a runtime PNG, preserving the fallback path.
  it('renders generated agent icon assets for supported runtimes', () => {
    const claudeRender = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);
    expect(claudeRender.getByTestId('project-avatar-image').props.source).toBe(
      claudeCodeIcon,
      'claude-code should use the orange pixel robot asset instead of the old vector avatar',
    );
    claudeRender.unmount();

    const codexRender = render(
      <AgentCard agent={{ ...agent, runtime: 'codex' }} onPress={() => {}} index={0} />,
    );
    expect(codexRender.getByTestId('project-avatar-image').props.source).toBe(
      codexIcon,
      'codex should use the blue cloud robot asset from mobile/assets/agent-icons',
    );
    codexRender.unmount();

    const cursorRender = render(
      <AgentCard agent={{ ...agent, runtime: 'cursor-cli' }} onPress={() => {}} index={0} />,
    );
    expect(cursorRender.getByTestId('project-avatar-image').props.source).toBe(
      cursorIcon,
      'cursor-cli should use the orange octopus robot asset from mobile/assets/agent-icons',
    );
    cursorRender.unmount();

    const customRender = render(
      <AgentCard agent={{ ...agent, runtime: 'custom' }} onPress={() => {}} index={0} />,
    );
    // Assertion failure means custom runtime claimed one of the fixed generated runtime icons.
    expect(customRender.queryByTestId('project-avatar-image')).toBeNull();
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

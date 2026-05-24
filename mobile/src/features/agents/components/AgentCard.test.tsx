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

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

describe('AgentCard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders project name and status meta for active rows', () => {
    const { getByText, queryByText } = render(
      <AgentCard
        agent={agent}
        onPress={() => {}}
        index={0}
        metaVariant="status"
        statusLabel="Running"
        isActive
      />,
    );
    expect(getByText('My Agent')).toBeTruthy();
    expect(getByText('Running')).toBeTruthy();
    expect(queryByText('Running · Claude Code')).toBeNull();
    expect(queryByText('/home/user/project')).toBeNull();
    expect(queryByText('LOCAL')).toBeNull();
  });

  it('renders machine and relative age meta for All Projects rows', () => {
    jest.spyOn(Date, 'now').mockReturnValue(121_000);

    const { getByText, queryByText } = render(
      <AgentCard
        agent={{ ...agent, endpoint_label: 'mac-home', created_at: 1 }}
        onPress={() => {}}
        index={0}
        statusLabel="Idle"
      />,
    );

    expect(getByText('mac-home · 2m ago')).toBeTruthy();
    expect(queryByText('Idle · Claude Code')).toBeNull();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<AgentCard agent={agent} onPress={onPress} index={0} />);
    fireEvent.press(getByText('My Agent'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  /// Pencli project row: avatar, labels, and chevron stay in one native flex row.
  ///
  /// Data construction:
  ///   agent = one Claude Code project.
  ///   runtime = "claude-code" maps to the Claude pixel canvas, #252525.
  ///   Row target from pencli:
  ///     rowHeight = 68
  ///     row horizontal padding = 14
  ///     avatarWidth = 40, with the runtime-specific pixel icon inside.
  ///     body starts after avatar marginRight = 10
  ///     chevron separated by marginLeft = 10
  ///
  /// Execution:
  ///   1. Render AgentCard.
  ///   2. Resolve Pressable style for the default unpressed state.
  ///   3. Read avatar, body, and chevron wrapper styles by testID.
  ///
  /// Expected:
  ///   - Positive: row uses RN-native flex layout, so it contributes height to the list group.
  ///   - Positive: text sits beside the avatar through explicit margins instead of unsupported gap.
  ///   - Negative: Pressable must not use a style callback, because native iOS was rendering it as a
  ///     default column and stacking avatar/text/chevron vertically.
  it('uses stable native flex geometry for the pencli project row', () => {
    const { getByTestId } = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);

    const row = getByTestId('project-row');
    expect(typeof row.props.style).toBe(
      'object',
      'project row should pass a static style object to Pressable; style callbacks broke native iOS layout',
    );
    const rowStyle = StyleSheet.flatten(row.props.style);
    const avatarStyle = StyleSheet.flatten(getByTestId('project-avatar').props.style);
    const bodyStyle = StyleSheet.flatten(getByTestId('project-body').props.style);
    const chevronStyle = StyleSheet.flatten(getByTestId('project-chevron').props.style);

    expectEqualWithReason(
      rowStyle.flexDirection,
      'row',
      'project row must stay horizontal to keep labels beside avatars',
    );
    expectEqualWithReason(rowStyle.height, 68, 'project row height should match pencli');
    expectEqualWithReason(
      rowStyle.paddingHorizontal,
      14,
      'project row horizontal padding should match pencli',
    );
    expectEqualWithReason(avatarStyle.width, 40, 'avatar width should match pencli');
    expectEqualWithReason(avatarStyle.height, 40, 'avatar height should match pencli');
    expectEqualWithReason(
      avatarStyle.marginRight,
      10,
      'avatar should create an explicit 10px gap before the text block',
    );
    expectEqualWithReason(avatarStyle.borderRadius, 9, 'avatar radius should match pencli');
    expectEqualWithReason(
      avatarStyle.backgroundColor,
      '#252525',
      'Claude Code avatar should use the dark pixel canvas behind the orange face',
    );
    expectEqualWithReason(
      bodyStyle.flex,
      1,
      'project text block should fill the space between avatar and chevron',
    );
    expectEqualWithReason(
      chevronStyle.marginLeft,
      10,
      'chevron should keep a stable 10px gap after the text block',
    );
    expectEqualWithReason(
      chevronStyle.width,
      14,
      'chevron wrapper should reserve icon width without shifting row text',
    );
  });

  /// Runtime pixel icons: each supported agent runtime uses the first generated mascot image.
  ///
  /// Data construction:
  ///   claudeAgent.runtime = "claude-code", so the card should show the generated orange mascot.
  ///   codexAgent.runtime  = "codex", so the card should show the generated robot mascot.
  ///   cursorAgent.runtime = "cursor-cli", so the card should show the generated cursor mascot.
  ///
  /// Execution:
  ///   1. Render one AgentCard for each runtime.
  ///   2. Query the runtime-specific image by testID.
  ///   3. Read each avatar background color.
  ///
  /// Expected:
  ///   - Positive: each runtime icon is an Image with a static local source.
  ///   - Positive: Codex, Claude Code, and Cursor keep their generated canvas colors.
  ///   - Negative: The three rows must not collapse to the old hand-built View icon.
  it('renders first-batch generated mascot images for Claude Code, Codex, and Cursor runtimes', () => {
    const claudeRender = render(<AgentCard agent={agent} onPress={() => {}} index={0} />);
    const claudeIcon = claudeRender.getByTestId('runtime-pixel-claude-code');
    const claudeGenericIcon = claudeRender.queryByTestId('runtime-pixel-generic-cpu');
    const claudeAvatarStyle = StyleSheet.flatten(
      claudeRender.getByTestId('project-avatar').props.style,
    );
    const claudeIconSource = claudeIcon.props.source;
    const claudeIconResizeMode = claudeIcon.props.resizeMode;
    const claudeIconStyle = StyleSheet.flatten(claudeIcon.props.style);
    claudeRender.unmount();

    const codexRender = render(
      <AgentCard agent={{ ...agent, runtime: 'codex' }} onPress={() => {}} index={0} />,
    );
    const codexIcon = codexRender.getByTestId('runtime-pixel-codex');
    const codexGenericIcon = codexRender.queryByTestId('runtime-pixel-generic-cpu');
    const codexAvatarStyle = StyleSheet.flatten(
      codexRender.getByTestId('project-avatar').props.style,
    );
    const codexIconSource = codexIcon.props.source;
    const codexIconResizeMode = codexIcon.props.resizeMode;
    const codexIconStyle = StyleSheet.flatten(codexIcon.props.style);
    codexRender.unmount();

    const cursorRender = render(
      <AgentCard agent={{ ...agent, runtime: 'cursor-cli' }} onPress={() => {}} index={0} />,
    );
    const cursorIcon = cursorRender.getByTestId('runtime-pixel-cursor-cli');
    const cursorGenericIcon = cursorRender.queryByTestId('runtime-pixel-generic-cpu');
    const cursorAvatarStyle = StyleSheet.flatten(
      cursorRender.getByTestId('project-avatar').props.style,
    );
    const cursorIconSource = cursorIcon.props.source;
    const cursorIconResizeMode = cursorIcon.props.resizeMode;
    const cursorIconStyle = StyleSheet.flatten(cursorIcon.props.style);

    expect(claudeIconSource).toBeTruthy();
    expect(codexIconSource).toBeTruthy();
    expect(cursorIconSource).toBeTruthy();
    expectEqualWithReason(
      claudeIconResizeMode,
      'cover',
      'Claude Code generated mascot should fill the 40px avatar frame',
    );
    expectEqualWithReason(
      codexIconResizeMode,
      'cover',
      'Codex generated mascot should fill the 40px avatar frame',
    );
    expectEqualWithReason(
      cursorIconResizeMode,
      'cover',
      'Cursor generated mascot should fill the 40px avatar frame',
    );
    expectEqualWithReason(claudeIconStyle.width, 40, 'Claude image width should match avatar');
    expectEqualWithReason(codexIconStyle.width, 40, 'Codex image width should match avatar');
    expectEqualWithReason(cursorIconStyle.width, 40, 'Cursor image width should match avatar');
    expectEqualWithReason(
      claudeAvatarStyle.backgroundColor,
      '#252525',
      'Claude Code should use a dark pixel canvas so the orange reference face is visible',
    );
    expectEqualWithReason(
      codexAvatarStyle.backgroundColor,
      '#FF6B35',
      'Codex should keep the primary orange avatar canvas',
    );
    expectEqualWithReason(
      cursorAvatarStyle.backgroundColor,
      '#2563EB',
      'Cursor should use the blue avatar canvas instead of the old index-based rotation',
    );
    expect(claudeGenericIcon).toBeNull();
    expect(codexGenericIcon).toBeNull();
    expect(cursorGenericIcon).toBeNull();
  });
});

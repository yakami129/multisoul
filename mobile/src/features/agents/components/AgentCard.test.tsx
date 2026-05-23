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
  ///   index = 0 maps to the first pencli avatar color, #FF6B35.
  ///   Row target from pencli:
  ///     rowHeight = 68
  ///     row horizontal padding = 14
  ///     avatarWidth = 40
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
      '#FF6B35',
      'first project avatar should use the user-provided pencli orange',
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
});

import { render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { RunningAgentBreath } from './RunningAgentBreath';

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

describe('RunningAgentBreath', () => {
  /// Soft Wash mode: animated running cards use one full-card wash as the main motion.
  ///
  /// Data construction:
  ///   enabled       = true
  ///   reducedMotion = false
  ///   accentColor   = #FF6B35 from the design whitelist
  ///   visual choice = user-selected full-card soft wash
  ///
  /// Execution process:
  ///   1. Render RunningAgentBreath in animated mode.
  ///   2. Query the liquid wash and frame.
  ///   3. Assert side pool layers and old debug-like particles/avatar aura are absent.
  ///
  /// Expected result:
  ///   - Positive: one wash layer fills the full card behind row content.
  ///   - Negative: no separate left or right breathing circles are rendered.
  ///   - Negative: old particle/aura stack is absent, avoiding a noisy overlay look.
  ///   - Negative: reduced-motion static frame is absent in animated mode.
  it('renders one full-card soft wash when enabled and Reduce Motion is off', () => {
    const { getByTestId, queryAllByTestId, queryByTestId } = render(
      <RunningAgentBreath enabled accentColor="#FF6B35" reducedMotion={false} />,
    );

    const rootStyle = StyleSheet.flatten(getByTestId('running-agent-breath').props.style);
    const washStyle = StyleSheet.flatten(getByTestId('running-agent-liquid-wash').props.style);

    expectEqualWithReason(
      rootStyle.position,
      'absolute',
      'breathing chrome should sit behind card content without changing row layout',
    );
    expectEqualWithReason(
      [washStyle.top, washStyle.right, washStyle.bottom, washStyle.left],
      [-4, -4, -4, -4],
      'soft wash should overfill all card edges so the largest layer covers the full row',
    );
    expect(getByTestId('running-agent-liquid-wash')).toBeTruthy();
    expect(getByTestId('running-agent-liquid-frame')).toBeTruthy();
    expectEqualWithReason(
      queryByTestId('running-agent-liquid-warm-pool') === null,
      true,
      'Soft Wash should not render a separate left-side breathing circle',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-liquid-status-pool') === null,
      true,
      'Soft Wash should not render a separate right-side breathing circle',
    );
    expectEqualWithReason(
      queryAllByTestId('running-agent-breath-particle').length,
      0,
      'Soft Wash should not render the previous noisy particle layer',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath-avatar-aura') === null,
      true,
      'Soft Wash should not use an avatar-only aura as the main effect',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath-static') === null,
      true,
      'animated mode must not render the reduced-motion static frame',
    );
  });

  /// Reduce Motion mode: enabled running cards keep a static affordance without a loop.
  ///
  /// Data construction:
  ///   enabled       = true
  ///   reducedMotion = true
  ///
  /// Execution process:
  ///   1. Render RunningAgentBreath with Reduce Motion on.
  ///   2. Query static and animated-only layers.
  ///
  /// Expected result:
  ///   - Positive: static highlighted frame is present.
  ///   - Negative: animated liquid layers are absent.
  it('renders only a static highlighted frame when Reduce Motion is enabled', () => {
    const { getByTestId, queryByTestId } = render(
      <RunningAgentBreath enabled accentColor="#FF6B35" reducedMotion />,
    );

    expect(getByTestId('running-agent-breath-static')).toBeTruthy();
    expectEqualWithReason(
      queryByTestId('running-agent-liquid-wash') === null,
      true,
      'Reduce Motion mode should not render the animated liquid wash',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-liquid-warm-pool') === null,
      true,
      'Reduce Motion mode should not render animated warm pool layers',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-liquid-status-pool') === null,
      true,
      'Reduce Motion mode should not render animated status pool layers',
    );
  });

  /// Disabled mode: non-running cards do not render effect chrome.
  ///
  /// Data construction:
  ///   enabled = false
  ///
  /// Execution process:
  ///   1. Render RunningAgentBreath disabled.
  ///   2. Query root and static layers.
  ///
  /// Expected result:
  ///   - Positive: component returns null for non-running rows.
  ///   - Negative: idle or awaiting-question rows do not receive decorative chrome.
  it('renders nothing when disabled', () => {
    const { queryByTestId } = render(
      <RunningAgentBreath enabled={false} accentColor="#FF6B35" reducedMotion={false} />,
    );

    expectEqualWithReason(
      queryByTestId('running-agent-breath') === null,
      true,
      'disabled breathing effect should not render a root layer',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath-static') === null,
      true,
      'disabled breathing effect should not render reduced-motion chrome either',
    );
  });
});

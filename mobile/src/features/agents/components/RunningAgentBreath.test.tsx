import { render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { RunningAgentBreath } from './RunningAgentBreath';

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

describe('RunningAgentBreath', () => {
  /// Liquid Status mode: animated running cards use one soft internal flow as the main motion.
  ///
  /// Data construction:
  ///   enabled       = true
  ///   reducedMotion = false
  ///   accentColor   = #FF6B35 from the design whitelist
  ///   visual choice = C. Liquid Status from the motion prototype
  ///
  /// Execution process:
  ///   1. Render RunningAgentBreath in animated mode.
  ///   2. Query the liquid band, low-emphasis pools, and frame.
  ///   3. Assert old debug-like particles/avatar aura are absent.
  ///
  /// Expected result:
  ///   - Positive: liquid band is the primary animated layer behind card content.
  ///   - Positive: auxiliary layers stay few and low-emphasis.
  ///   - Negative: old particle/aura stack is absent, avoiding a noisy overlay look.
  ///   - Negative: reduced-motion static frame is absent in animated mode.
  it('renders liquid status layers when enabled and Reduce Motion is off', () => {
    const { getByTestId, queryAllByTestId, queryByTestId } = render(
      <RunningAgentBreath enabled accentColor="#FF6B35" reducedMotion={false} />,
    );

    const rootStyle = StyleSheet.flatten(getByTestId('running-agent-breath').props.style);

    expectEqualWithReason(
      rootStyle.position,
      'absolute',
      'breathing chrome should sit behind card content without changing row layout',
    );
    expect(getByTestId('running-agent-liquid-band')).toBeTruthy();
    expect(getByTestId('running-agent-liquid-warm-pool')).toBeTruthy();
    expect(getByTestId('running-agent-liquid-status-pool')).toBeTruthy();
    expect(getByTestId('running-agent-liquid-frame')).toBeTruthy();
    expectEqualWithReason(
      queryAllByTestId('running-agent-breath-particle').length,
      0,
      'Liquid Status should not render the previous noisy particle layer',
    );
    expectEqualWithReason(
      queryByTestId('running-agent-breath-avatar-aura') === null,
      true,
      'Liquid Status should not use an avatar-only aura as the main effect',
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
      queryByTestId('running-agent-liquid-band') === null,
      true,
      'Reduce Motion mode should not render the animated liquid band',
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

import { render } from '@testing-library/react-native';
import React from 'react';
import { Modal, StyleSheet } from 'react-native';
import { AgentEndpointFilterSheet } from './AgentEndpointFilterSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const options = [
  { id: 'all', label: 'All Machines', count: 2 },
  { id: 'mac', label: 'Mac', count: 1 },
];

function assertFalsy(value: unknown, message: string) {
  expect({ actual: Boolean(value), reason: message }).toEqual({
    actual: false,
    reason: expect.any(String),
  });
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  expect({ actual, reason: message }).toEqual({ actual: expected, reason: expect.any(String) });
}

function renderSheet() {
  return render(
    <AgentEndpointFilterSheet
      visible={true}
      options={options}
      selectedEndpointId="all"
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );
}

describe('AgentEndpointFilterSheet', () => {
  /// Endpoint filter sheet motion: the scrim must fade in place instead of sliding.
  ///
  /// Data construction:
  ///   visible = true, so the modal and drawer are mounted.
  ///   options = "All Machines" and "Mac", enough to render the option group.
  ///   selectedEndpointId = "all", so the first row shows the selected check slot.
  ///
  /// Execution process:
  ///   1. Render the endpoint filter sheet in its visible state.
  ///   2. Inspect the React Native Modal animation contract.
  ///   3. Inspect the scrim visual style separately from the bottom panel style.
  ///
  /// Expected result:
  ///   - Positive assertion: Modal uses fade instead of slide.
  ///   - Positive assertion: sheet panel still renders as the bottom drawer body.
  ///   - Negative assertion: scrim does not own transform, so it cannot slide to the bottom.
  it('keeps the scrim fixed while the filter sheet appears', () => {
    const { UNSAFE_getByType, getByTestId } = renderSheet();

    const modal = UNSAFE_getByType(Modal);
    const scrimStyle = StyleSheet.flatten(
      getByTestId('endpoint-filter-scrim-visual').props.style,
    ) as { transform?: unknown };
    const panelStyle = StyleSheet.flatten(getByTestId('endpoint-filter-panel').props.style) as {
      backgroundColor?: string;
      transform?: unknown;
    };

    assertEqual(
      modal.props.animationType,
      'fade',
      'Modal must use fade instead of slide so the scrim does not move with the panel',
    );
    assertFalsy(scrimStyle.transform, 'scrim must not carry panel translateY transform');
    assertEqual(
      panelStyle.backgroundColor,
      '#F6F3EC',
      'bottom panel should still render as the cream drawer body',
    );
    assertFalsy(panelStyle.transform, 'bottom panel should not rely on Modal slide compensation');
  });
});

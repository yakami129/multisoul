import { StyleSheet } from 'react-native';
import { s } from '../../app/chat/styles';

/// Chat input bottom spacing: the composer must not add a fixed spacer below itself.
///
/// Data construction:
///   ChatDetailScreen already renders inside SafeAreaView, so a second fixed
///   bottom spacer compounds the native bottom inset.
///   Previous spacer height = 34 px.
///   Expected extra fixed spacer height = 0 px.
///
/// Execution process:
///   1. Read the exported chat screen styles.
///   2. Flatten the safeArea style so numeric layout values are directly visible.
///
/// Expected result:
///   - Positive assertion: safeArea style still resolves to an object, so the
///     check is inspecting the intended layout slot.
///   - Negative assertion: height must not be 34, because that creates the
///     visible blank gap under the chat input.
///   - Boundary assertion: height must be 0, because bottom inset handling
///     belongs to SafeAreaView, not an extra fixed View.
test('chat input does not add a fixed bottom spacer under the composer', () => {
  const safeArea = StyleSheet.flatten(s.safeArea);

  expect(safeArea).toBeTruthy();
  expect(safeArea.height).not.toBe(
    34,
    'chat input must not keep the old 34px spacer below the composer',
  );
  expect(safeArea.height).toBe(0, 'chat input bottom spacer should collapse to zero height');
});

/// Chat composer edge spacing: the floating input tray must not touch the phone frame.
///
/// Data construction:
///   horizontal breathing room target >= 20 px, matching iOS floating tray margins.
///   top breathing room target        >= 12 px, separating transcript from composer.
///   bottom breathing room target     >= 20 px, keeping the tray off the device edge.
///
/// Execution process:
///   1. Read the exported chat screen styles.
///   2. Flatten inputArea so numeric padding values are directly visible.
///
/// Expected result:
///   - Positive assertion: inputArea style resolves to an object.
///   - Boundary assertion: horizontal padding is at least 20 px.
///   - Boundary assertion: bottom padding is at least 20 px.
///   - Negative assertion: padding must not be 0, because that recreates the
///     screenshot issue where the card visually sticks to the phone frame.
test('chat composer input area keeps the tray away from screen edges', () => {
  const inputArea = StyleSheet.flatten(s.inputArea);

  expect(inputArea).toBeTruthy();
  expect(inputArea.paddingHorizontal).toBeGreaterThanOrEqual(
    20,
    'composer must keep at least 20px horizontal margin from the phone frame',
  );
  expect(inputArea.paddingTop).toBeGreaterThanOrEqual(
    12,
    'composer must keep visible breathing room above the tray',
  );
  expect(inputArea.paddingBottom).toBeGreaterThanOrEqual(
    20,
    'composer must keep at least 20px bottom margin from the phone frame',
  );
  expect(inputArea.paddingHorizontal).not.toBe(
    0,
    'composer horizontal padding must not collapse to the screen edge',
  );
});

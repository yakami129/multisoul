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

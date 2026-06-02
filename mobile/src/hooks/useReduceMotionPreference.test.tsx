import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReduceMotionPreference } from './useReduceMotionPreference';

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

describe('useReduceMotionPreference', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /// Reduce Motion initial state: hook mirrors the native accessibility preference.
  ///
  /// Data construction:
  ///   native isReduceMotionEnabled() = true
  ///   initial hook state             = false until the async native value resolves
  ///
  /// Execution process:
  ///   1. Mock AccessibilityInfo.isReduceMotionEnabled() to resolve true.
  ///   2. Render useReduceMotionPreference().
  ///   3. Wait for the hook to receive the native preference.
  ///
  /// Expected result:
  ///   - Positive: hook eventually returns true.
  ///   - Positive: hook subscribes to reduceMotionChanged.
  ///   - Negative: hook does not stay at the default false value after the native result resolves.
  it('loads the initial Reduce Motion preference from AccessibilityInfo', async () => {
    const remove = jest.fn();
    const isReduceMotionEnabled = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const addEventListener = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove } as never);

    const { result } = renderHook(() => useReduceMotionPreference());

    await waitFor(() => {
      expectEqualWithReason(
        result.current,
        true,
        'hook should reflect the enabled native Reduce Motion setting',
      );
    });
    expectEqualWithReason(
      isReduceMotionEnabled.mock.calls.length,
      1,
      'hook should query the native setting exactly once on mount',
    );
    expectEqualWithReason(
      addEventListener.mock.calls[0][0],
      'reduceMotionChanged',
      'hook should subscribe to Reduce Motion changes',
    );
    expectEqualWithReason(
      result.current === false,
      false,
      'hook must not keep the default false value after native Reduce Motion resolves true',
    );
  });

  /// Reduce Motion runtime changes: native events update the hook without remounting.
  ///
  /// Data construction:
  ///   initial native value = false
  ///   event value          = true
  ///
  /// Execution process:
  ///   1. Render the hook with native Reduce Motion disabled.
  ///   2. Invoke the subscribed reduceMotionChanged listener with true.
  ///   3. Inspect the hook value.
  ///
  /// Expected result:
  ///   - Positive: hook changes to true after the event.
  ///   - Negative: hook does not require a remount to observe the new preference.
  it('updates when Reduce Motion changes at runtime', async () => {
    let listener: ((enabled: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, callback) => {
      listener = callback;
      return { remove: jest.fn() } as never;
    });

    const { result } = renderHook(() => useReduceMotionPreference());

    await waitFor(() => {
      expectEqualWithReason(
        result.current,
        false,
        'hook should start from the disabled native Reduce Motion value',
      );
    });
    act(() => {
      listener?.(true);
    });

    expectEqualWithReason(
      result.current,
      true,
      'hook should update when the native reduceMotionChanged event fires',
    );
    expectEqualWithReason(
      listener === undefined,
      false,
      'test must capture the active subscription listener before invoking it',
    );
  });

  /// Reduce Motion cleanup: unmount removes the native event subscription.
  ///
  /// Data construction:
  ///   subscription.remove = mock function
  ///
  /// Execution process:
  ///   1. Render the hook.
  ///   2. Unmount the hook.
  ///   3. Inspect the subscription remove call.
  ///
  /// Expected result:
  ///   - Positive: remove is called once on unmount.
  ///   - Negative: native subscription is not leaked after the card list unmounts.
  it('removes the native Reduce Motion subscription on unmount', () => {
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove } as never);

    const { unmount } = renderHook(() => useReduceMotionPreference());
    unmount();

    expectEqualWithReason(
      remove.mock.calls.length,
      1,
      'hook should remove the native Reduce Motion subscription on unmount',
    );
    expectEqualWithReason(
      remove.mock.calls.length === 0,
      false,
      'hook must not leak the native Reduce Motion subscription',
    );
  });
});

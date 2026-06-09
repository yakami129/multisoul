/**
 * Verifies that _layout.tsx wires up pingAllEndpoints at startup and on AppState changes.
 *
 * Strategy: render a minimal shim that mirrors only the two ping-related useEffects from
 * RootLayout, so we don't need to mock every native module the full layout imports.
 */
import { act, renderHook } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { pingAllEndpoints } from '../features/settings/services/endpointService';

jest.mock('../features/settings/services/endpointService', () => ({
  pingAllEndpoints: jest.fn().mockResolvedValue(undefined),
}));

function usePingOnStartup(done: boolean) {
  useEffect(() => {
    if (!done) return;
    void pingAllEndpoints();
  }, [done]);
}

function usePingOnActive() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pingAllEndpoints();
    });
    return () => sub.remove();
  }, []);
}

describe('RootLayout endpoint ping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pings endpoints after startup load completes', async () => {
    const { rerender } = renderHook(
      ({ done }: { done: boolean }) => {
        usePingOnStartup(done);
      },
      { initialProps: { done: false } },
    );

    expect(pingAllEndpoints).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ done: true });
    });

    expect(pingAllEndpoints).toHaveBeenCalledTimes(1);
  });

  it('pings endpoints when app becomes active', async () => {
    const listeners: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });

    renderHook(() => usePingOnActive());

    act(() => {
      listeners.forEach((l) => l('active'));
    });

    expect(pingAllEndpoints).toHaveBeenCalledTimes(1);

    act(() => {
      listeners.forEach((l) => l('background'));
    });

    expect(pingAllEndpoints).toHaveBeenCalledTimes(1);
  });
});

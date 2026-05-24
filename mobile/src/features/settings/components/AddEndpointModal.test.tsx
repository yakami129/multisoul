import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { StyleSheet } from 'react-native';
import { getEndpointClient } from '@/api/endpointClient';
import { AddEndpointModal } from './AddEndpointModal';

jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

let mockCameraProps: { onBarcodeScanned?: (event: { data: string }) => void } | null = null;
let mockPermissionGranted = false;
const mockRequestPermission = jest.fn();

jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned?: (event: { data: string }) => void }) => {
    const React = require('react');
    const { View } = require('react-native');
    mockCameraProps = props;
    return React.createElement(View, { testID: 'camera-view' });
  },
  useCameraPermissions: () => [{ granted: mockPermissionGranted }, mockRequestPermission],
}));

beforeEach(() => {
  mockCameraProps = null;
  mockPermissionGranted = false;
  mockRequestPermission.mockClear();
  (getEndpointClient as jest.Mock).mockReturnValue({
    get: jest.fn(),
  });
});

/// Add endpoint QR entry: initialTab="qr" opens the full-screen scan flow, not the old centered card.
///
/// Data construction:
///   visible    = true, so the modal content is mounted.
///   initialTab = "qr", so QR should be selected before any user tap.
///   permission = granted false from the camera mock, so QR mode renders the permission CTA.
///
/// Execution:
///   1. Render AddEndpointModal with initialTab="qr".
///   2. Query the full-screen prototype copy and QR help button.
///   3. Verify old centered-card-only heading is absent before switching tabs.
///
/// Expected:
///   - Positive: "Connect a machine" exists, matching the pencli Add Endpoint screen.
///   - Positive: "Scan setup QR" exists above the scanner area.
///   - Positive: "Show setup commands" help control exists next to SCAN QR.
///   - Negative: "MANUAL" is absent because Add Endpoint is QR-only.
///   - Negative: legacy "ADD ENDPOINT" centered-card heading is not shown for Agents QR entry.
it('opens the Agents QR entry as the full-screen scan flow with setup help', () => {
  render(<AddEndpointModal visible onClose={() => {}} onAdd={() => {}} initialTab="qr" />);

  expect(screen.getByText('Connect a machine')).toBeTruthy();
  expect(screen.getByText('Scan setup QR')).toBeTruthy();
  expect(screen.getByText('TAP TO ALLOW CAMERA')).toBeTruthy();
  expect(screen.getByLabelText('Show setup commands')).toBeTruthy();
  expect(screen.queryByText('MANUAL')).toBeNull();
  expect(screen.queryByText('Paste connection string')).toBeNull();
  expect(screen.queryByText('ADD ENDPOINT')).toBeNull();
});

/// QR scan connect: scanning a pairing QR creates the endpoint without a manual label step.
///
/// Data construction:
///   QR URL parameter = "https://mac-home.tailnet.ts.net:8765".
///   QR token         = "test-token".
///   Expected label   = hostname("https://mac-home.tailnet.ts.net:8765") = "mac-home.tailnet.ts.net".
///
/// Execution:
///   1. Enable camera permission so CameraView mounts.
///   2. Render AddEndpointModal in QR mode.
///   3. Invoke CameraView.onBarcodeScanned with a multisoul pairing URL.
///   4. Wait for the health check path to call onAdd and close the flow.
///
/// Expected:
///   - Positive: onAdd receives hostname/IP as the endpoint label.
///   - Positive: onAdd receives the scanned base URL and token unchanged.
///   - Positive: the modal closes after successful scan registration.
///   - Negative: the old placeholder label "Home Server" is not used.
it('adds the scanned endpoint with the URL hostname as its label', async () => {
  mockPermissionGranted = true;
  const onAdd = jest.fn();
  const onClose = jest.fn();
  render(<AddEndpointModal visible onClose={onClose} onAdd={onAdd} initialTab="qr" />);

  expect(screen.getByTestId('camera-view')).toBeTruthy();
  act(() => {
    mockCameraProps?.onBarcodeScanned?.({
      data: 'multisoul://pair?url=https%3A%2F%2Fmac-home.tailnet.ts.net%3A8765&token=test-token',
    });
  });

  await waitFor(() => {
    expect(onAdd).toHaveBeenCalledWith(
      'mac-home.tailnet.ts.net',
      'https://mac-home.tailnet.ts.net:8765',
      'test-token',
    );
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onAdd).not.toHaveBeenCalledWith(
    'Home Server',
    'https://mac-home.tailnet.ts.net:8765',
    'test-token',
  );
});

/// QR scan duplicate guard: repeated camera callbacks for the same QR must add only one endpoint.
///
/// Data construction:
///   QR URL parameter = "https://mac-home.tailnet.ts.net:8765".
///   QR token         = "test-token".
///   Duplicate scans  = 2 callbacks fired in the same React render tick before state can re-render.
///
/// Execution:
///   1. Enable camera permission so CameraView mounts.
///   2. Render AddEndpointModal in QR mode.
///   3. Invoke CameraView.onBarcodeScanned twice with the same valid QR payload in one act block.
///   4. Wait for the health check path to complete.
///
/// Expected:
///   - Positive: onAdd receives the parsed endpoint once.
///   - Positive: onClose is called once after the single successful registration.
///   - Negative: onAdd is not called twice for the same QR payload.
///   - Negative: onClose is not called twice by duplicate scan events.
it('ignores duplicate camera callbacks while one QR registration is already in flight', async () => {
  mockPermissionGranted = true;
  const onAdd = jest.fn();
  const onClose = jest.fn();
  const payload =
    'multisoul://pair?url=https%3A%2F%2Fmac-home.tailnet.ts.net%3A8765&token=test-token';
  render(<AddEndpointModal visible onClose={onClose} onAdd={onAdd} initialTab="qr" />);

  act(() => {
    mockCameraProps?.onBarcodeScanned?.({ data: payload });
    mockCameraProps?.onBarcodeScanned?.({ data: payload });
  });

  await waitFor(() => {
    expect(onAdd).toHaveBeenCalledWith(
      'mac-home.tailnet.ts.net',
      'https://mac-home.tailnet.ts.net:8765',
      'test-token',
    );
  });
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(onAdd).not.toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalledTimes(2);
});

/// QR scan connection failure: a valid pairing QR must not be reported as an invalid QR code.
///
/// Data construction:
///   QR URL parameter = "https://mac-home.tailnet.ts.net:8765", so parsing and hostname naming are valid.
///   QR token         = "test-token".
///   healthz result   = rejected promise, simulating a machine that is offline or unreachable.
///   fallback fetch   = rejected promise, so the connection path fails after the QR has parsed.
///
/// Execution:
///   1. Enable camera permission so CameraView mounts.
///   2. Mock endpoint healthz and fallback fetch to fail.
///   3. Scan a syntactically valid multisoul pairing QR.
///   4. Wait for the connection failure message.
///
/// Expected:
///   - Positive: the UI reports that the endpoint cannot be reached.
///   - Positive: onAdd is not called because the health check failed.
///   - Negative: the UI does not show "INVALID QR CODE" for a valid but unreachable QR target.
///   - Negative: the modal does not close after a failed connection attempt.
it('shows connection failure instead of invalid QR when a valid QR target is unreachable', async () => {
  mockPermissionGranted = true;
  const onAdd = jest.fn();
  const onClose = jest.fn();
  (getEndpointClient as jest.Mock).mockReturnValue({
    get: jest.fn().mockRejectedValue(new Error('offline')),
  });
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  try {
    render(<AddEndpointModal visible onClose={onClose} onAdd={onAdd} initialTab="qr" />);

    act(() => {
      mockCameraProps?.onBarcodeScanned?.({
        data: 'multisoul://pair?url=https%3A%2F%2Fmac-home.tailnet.ts.net%3A8765&token=test-token',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('CANNOT REACH ENDPOINT')).toBeTruthy();
    });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByText('INVALID QR CODE')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  }
});

/// Add endpoint QR back affordance: Connect a machine must expose an obvious return button.
///
/// Data construction:
///   visible    = true, so the full-screen modal is mounted.
///   initialTab = "qr", so this is the Agents Add Endpoint route.
///   onClose    = jest.fn(), so pressing back can be observed exactly once.
///
/// Execution:
///   1. Render AddEndpointModal with initialTab="qr".
///   2. Locate the "Back to Agents" control in the top navigation.
///   3. Flatten its style to verify the button has a visible surface and border.
///   4. Press the control and observe close behavior.
///
/// Expected:
///   - Positive: the back control has a dark button surface, so it is visually discoverable.
///   - Positive: the back control has a border, so it reads as tappable against the nav bar.
///   - Positive: pressing it calls onClose once.
///   - Negative: pressing it does not leave onClose uncalled.
it('renders a visually framed Agents back button that closes the full-screen flow', () => {
  const onClose = jest.fn();
  render(<AddEndpointModal visible onClose={onClose} onAdd={() => {}} initialTab="qr" />);

  const backButton = screen.getByLabelText('Back to Agents');
  const buttonStyle = StyleSheet.flatten(backButton.props.style);

  expect(buttonStyle.backgroundColor).toBe('#1A1A1A');
  expect(buttonStyle.borderWidth).toBe(1);
  expect(buttonStyle.borderColor).toBe('#2A2A2A');

  fireEvent.press(backButton);

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalledTimes(0);
});

/// Add endpoint QR close affordance: Connect a machine content must include a visible exit button.
///
/// Data construction:
///   visible    = true, so the full-screen modal is mounted.
///   initialTab = "qr", so the QR-only Connect a machine view is shown.
///   onClose    = jest.fn(), so the close button effect is observable.
///
/// Execution:
///   1. Render AddEndpointModal with initialTab="qr".
///   2. Locate the content-level "Close Add Endpoint" button near the title.
///   3. Flatten its style to verify it has a visible surface and border.
///   4. Press the close button.
///
/// Expected:
///   - Positive: an explicit close control exists in the content header.
///   - Positive: the close control has a visible dark surface and border.
///   - Positive: pressing it calls onClose once.
///   - Negative: pressing it does not leave the modal open with onClose uncalled.
it('renders an explicit content-level close button for the QR-only flow', () => {
  const onClose = jest.fn();
  render(<AddEndpointModal visible onClose={onClose} onAdd={() => {}} initialTab="qr" />);

  const closeButton = screen.getByLabelText('Close Add Endpoint');
  const closeStyle = StyleSheet.flatten(closeButton.props.style);

  expect(closeStyle.backgroundColor).toBe('#1A1A1A');
  expect(closeStyle.borderWidth).toBe(1);
  expect(closeStyle.borderColor).toBe('#2A2A2A');

  fireEvent.press(closeButton);

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalledTimes(0);
});

/// Setup help sheet: QR help opens a bottom sheet with all setup sections.
///
/// Data construction:
///   sections = install msctl + start service + register agent variants.
///   variants = Codex, Claude Code, Cursor Agent CLI from the product prompt.
///
/// Execution:
///   1. Render AddEndpointModal in QR mode.
///   2. Press the setup help button.
///   3. Read visible heading, explanatory copy, and section labels.
///
/// Expected:
///   - Positive: setup sheet heading and explanatory sentence are visible.
///   - Positive: all six required sections are visible.
///   - Negative: unrelated manual field label "TOKEN" is not introduced by the help sheet.
it('shows setup commands for install, service start, and all agent runtime variants', () => {
  render(<AddEndpointModal visible onClose={() => {}} onAdd={() => {}} initialTab="qr" />);

  fireEvent.press(screen.getByLabelText('Show setup commands'));

  expect(screen.getByText('Set up local agent')).toBeTruthy();
  expect(screen.getByText('Run these commands on the machine you want to connect.')).toBeTruthy();
  expect(screen.getByText('1. Install msctl')).toBeTruthy();
  expect(screen.getByText('2. Start service')).toBeTruthy();
  expect(screen.getByText('3. Register an Agent')).toBeTruthy();
  expect(screen.getByText('Codex')).toBeTruthy();
  expect(screen.getByText('Claude Code')).toBeTruthy();
  expect(screen.getByText('Cursor Agent CLI')).toBeTruthy();
  expect(screen.queryByText('TOKEN')).toBeNull();
});

/// Setup command copy: Codex copy button copies only the Codex registration command.
///
/// Data construction:
///   target section = Codex.
///   expected command contains:
///     "msctl agent register"
///     "--runtime codex"
///     "--mode full-auto"
///   excluded command fragment = "cursor-cli" from the Cursor runtime.
///
/// Execution:
///   1. Render AddEndpointModal in QR mode.
///   2. Open setup help.
///   3. Press the Codex section copy button.
///
/// Expected:
///   - Positive: Clipboard receives the Codex command body.
///   - Positive: the command includes the full-auto mode flag.
///   - Negative: the copied Codex payload does not contain the Cursor runtime.
it('copies the Codex registration command without mixing in other runtime commands', async () => {
  (Clipboard.setStringAsync as jest.Mock).mockClear();
  render(<AddEndpointModal visible onClose={() => {}} onAdd={() => {}} initialTab="qr" />);

  fireEvent.press(screen.getByLabelText('Show setup commands'));
  fireEvent.press(screen.getByLabelText('Copy Codex command'));

  await waitFor(() => {
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
  });
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
    expect.stringContaining('msctl agent register'),
  );
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('--runtime codex'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
    expect.stringContaining('--mode full-auto'),
  );
  expect(Clipboard.setStringAsync).not.toHaveBeenCalledWith(expect.stringContaining('cursor-cli'));
});

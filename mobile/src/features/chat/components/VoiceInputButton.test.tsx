import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import VoiceInputButton from './VoiceInputButton';
import { useVoiceInput, type UseVoiceInputResult } from '../hooks/useVoiceInput';

jest.mock('../hooks/useVoiceInput', () => ({
  useVoiceInput: jest.fn(),
}));

const mockUseVoiceInput = useVoiceInput as jest.MockedFunction<typeof useVoiceInput>;

function voiceControls(overrides: Partial<UseVoiceInputResult> = {}): UseVoiceInputResult {
  return {
    cancelVoiceInput: jest.fn(),
    isAvailable: true,
    isBusy: false,
    startVoiceInput: jest.fn(),
    status: 'idle',
    stopVoiceInput: jest.fn(),
    ...overrides,
  };
}

describe('VoiceInputButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseVoiceInput.mockReturnValue(voiceControls());
  });

  it('renders the idle iOS mic control at the composer scale', () => {
    const controls = voiceControls();
    mockUseVoiceInput.mockReturnValue(controls);
    const { getByLabelText, getByTestId } = render(
      <VoiceInputButton disabled={false} onTranscript={jest.fn()} />,
    );
    const shellStyle = StyleSheet.flatten(getByTestId('mic-shell').props.style);

    fireEvent.press(getByLabelText('Voice input'));

    expect(shellStyle.width).toBe(28);
    expect(shellStyle.height).toBe(28);
    expect(controls.startVoiceInput).toHaveBeenCalledTimes(1);
  });

  it('exposes disabled accessibility state for a disabled composer', () => {
    const controls = voiceControls();
    mockUseVoiceInput.mockReturnValue(controls);
    const { getByTestId } = render(<VoiceInputButton disabled onTranscript={jest.fn()} />);

    fireEvent.press(getByTestId('mic-btn'));

    expect(getByTestId('mic-btn').props.accessibilityState?.disabled).toBe(true);
    expect(controls.startVoiceInput).not.toHaveBeenCalled();
  });

  it('renders disabled when the hook reports Android or Web unavailable', () => {
    const controls = voiceControls({ isAvailable: false, status: 'unavailable' });
    mockUseVoiceInput.mockReturnValue(controls);
    const { getByTestId } = render(<VoiceInputButton disabled={false} onTranscript={jest.fn()} />);

    fireEvent.press(getByTestId('mic-btn'));

    expect(getByTestId('mic-btn').props.accessibilityState?.disabled).toBe(true);
    expect(controls.startVoiceInput).not.toHaveBeenCalled();
  });

  it('renders recording stop and cancel controls', () => {
    const controls = voiceControls({ status: 'recording', isBusy: true });
    mockUseVoiceInput.mockReturnValue(controls);
    const { getByTestId } = render(<VoiceInputButton disabled={false} onTranscript={jest.fn()} />);

    fireEvent.press(getByTestId('voice-stop-btn'));
    fireEvent.press(getByTestId('voice-cancel-btn'));

    expect(getByTestId('voice-recording-controls')).toBeTruthy();
    expect(controls.stopVoiceInput).toHaveBeenCalledTimes(1);
    expect(controls.cancelVoiceInput).toHaveBeenCalledTimes(1);
  });

  it('shows a stable disabled progress affordance while transcribing', () => {
    const controls = voiceControls({ status: 'transcribing', isBusy: true });
    mockUseVoiceInput.mockReturnValue(controls);
    const { getByTestId, getByLabelText } = render(
      <VoiceInputButton disabled={false} onTranscript={jest.fn()} />,
    );

    fireEvent.press(getByLabelText('Transcribing voice input'));

    expect(getByTestId('mic-btn').props.accessibilityState?.disabled).toBe(true);
    expect(controls.startVoiceInput).not.toHaveBeenCalled();
  });
});

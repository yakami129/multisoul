import { act, renderHook, type RenderHookResult } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule, TaskHintIOS } from 'expo-speech-recognition';
import { Alert, Linking, Platform } from 'react-native';
import { useVoiceInput, VOICE_INPUT_TIMEOUT_MS, type UseVoiceInputResult } from './useVoiceInput';
import {
  addVoiceRecognitionListener,
  loadVoiceRecognitionRuntime,
} from './voiceRecognitionRuntime';

type SpeechEventName = 'start' | 'result' | 'nomatch' | 'error' | 'end';
type SpeechListeners = Partial<Record<SpeechEventName, (event?: unknown) => void>>;

let mockSpeechListeners: SpeechListeners = {};

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(),
}));

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    addListener: jest.fn((name: SpeechEventName, listener: (event?: unknown) => void) => {
      mockSpeechListeners[name] = listener;
      return { remove: jest.fn() };
    }),
    abort: jest.fn(),
    isRecognitionAvailable: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  },
  TaskHintIOS: { dictation: 'dictation' },
  useSpeechRecognitionEvent: jest.fn(
    (name: SpeechEventName, listener: (event?: unknown) => void) => {
      mockSpeechListeners[name] = listener;
    },
  ),
}));

jest.mock('./voiceRecognitionRuntime', () => ({
  addVoiceRecognitionListener: jest.fn(
    (_runtime: unknown, name: SpeechEventName, listener: (event?: unknown) => void) => {
      mockSpeechListeners[name] = listener;
      return { remove: jest.fn() };
    },
  ),
  loadVoiceRecognitionRuntime: jest.fn(),
}));

const mockGetLocales = getLocales as jest.MockedFunction<typeof getLocales>;
const mockSpeechModule = ExpoSpeechRecognitionModule as jest.Mocked<
  typeof ExpoSpeechRecognitionModule
>;
const mockLoadVoiceRecognitionRuntime = loadVoiceRecognitionRuntime as jest.MockedFunction<
  typeof loadVoiceRecognitionRuntime
>;
const mockAddVoiceRecognitionListener = addVoiceRecognitionListener as jest.MockedFunction<
  typeof addVoiceRecognitionListener
>;
const originalPlatformOS = Platform.OS;

function setPlatformOS(os: 'ios' | 'android' | 'web') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

function grantedPermission() {
  return { canAskAgain: true, expires: 'never', granted: true, status: 'granted' };
}

function deniedPermission() {
  return { canAskAgain: false, expires: 'never', granted: false, status: 'denied' };
}

function renderVoiceHook(options: { disabled?: boolean; onTranscript?: jest.Mock } = {}) {
  return renderHook(() =>
    useVoiceInput({
      disabled: options.disabled ?? false,
      onTranscript: options.onTranscript ?? jest.fn(),
    }),
  );
}

async function start(result: RenderHookResult<UseVoiceInputResult, unknown>['result']) {
  await act(async () => {
    await result.current.startVoiceInput();
  });
}

function emit(name: SpeechEventName, event?: unknown) {
  act(() => {
    mockSpeechListeners[name]?.(event);
  });
}

describe('useVoiceInput', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockSpeechListeners = {};
    jest.clearAllMocks();
    setPlatformOS('ios');
    mockLoadVoiceRecognitionRuntime.mockResolvedValue({
      ExpoSpeechRecognitionModule,
      TaskHintIOS,
    });
    mockGetLocales.mockReturnValue([{ languageTag: 'ja-JP' } as ReturnType<typeof getLocales>[0]]);
    mockSpeechModule.isRecognitionAvailable.mockReturnValue(true);
    mockSpeechModule.requestPermissionsAsync.mockResolvedValue(grantedPermission());
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    setPlatformOS(originalPlatformOS as 'ios');
  });

  it('starts iOS recognition with the system locale and non-persistent options', async () => {
    const { result } = renderVoiceHook();

    await start(result);

    expect(mockSpeechModule.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockSpeechModule.start).toHaveBeenCalledWith(
      expect.objectContaining({
        continuous: false,
        interimResults: true,
        iosTaskHint: 'dictation',
        lang: 'ja-JP',
      }),
    );
    expect(mockSpeechModule.start.mock.calls[0]?.[0]).not.toHaveProperty('recordingOptions');
    expect(result.current.status).toBe('recording');
  });

  it('stops recording, waits for final end, and commits the transcript once', async () => {
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    act(() => result.current.stopVoiceInput());
    emit('result', { isFinal: true, results: [{ transcript: 'hello voice' }] });
    emit('end');

    expect(mockSpeechModule.stop).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('hello voice');
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('cancels recording without committing transcript or surfacing aborted errors', async () => {
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    act(() => result.current.cancelVoiceInput());
    emit('result', { isFinal: true, results: [{ transcript: 'discard me' }] });
    emit('error', { error: 'aborted', message: 'aborted' });
    emit('end');

    expect(mockSpeechModule.abort).toHaveBeenCalledTimes(1);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('disables Android and Web without touching the native recognizer', async () => {
    setPlatformOS('android');
    const { result, rerender } = renderVoiceHook();

    await start(result);
    expect(result.current.status).toBe('unavailable');
    expect(mockSpeechModule.start).not.toHaveBeenCalled();

    setPlatformOS('web');
    rerender({});
    await start(result);
    expect(result.current.status).toBe('unavailable');
    expect(mockSpeechModule.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not start when the composer is disabled', async () => {
    const { result } = renderVoiceHook({ disabled: true });

    await start(result);

    expect(result.current.isAvailable).toBe(false);
    expect(mockSpeechModule.start).not.toHaveBeenCalled();
  });

  it('shows the permission alert and opens settings from the action button', async () => {
    mockSpeechModule.requestPermissionsAsync.mockResolvedValue(deniedPermission());
    const { result } = renderVoiceHook();

    await start(result);
    const settingsButton = (Alert.alert as jest.Mock).mock.calls[0]?.[2]?.[1];
    settingsButton?.onPress?.();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Voice input permissions needed',
      expect.any(String),
      expect.any(Array),
    );
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(mockSpeechModule.start).not.toHaveBeenCalled();
  });

  it('marks speech recognition unavailable when native support is missing', async () => {
    mockSpeechModule.isRecognitionAvailable.mockReturnValue(false);
    const { result } = renderVoiceHook();

    await start(result);

    expect(result.current.status).toBe('unavailable');
    expect(Alert.alert).toHaveBeenCalledWith('Voice input unavailable', expect.any(String));
    expect(mockSpeechModule.start).not.toHaveBeenCalled();
  });

  it('keeps chat usable when the speech recognition native module is absent', async () => {
    mockLoadVoiceRecognitionRuntime.mockResolvedValue(null);
    const { result } = renderVoiceHook();

    await start(result);

    expect(result.current.status).toBe('unavailable');
    expect(Alert.alert).toHaveBeenCalledWith('Voice input unavailable', expect.any(String));
    expect(mockAddVoiceRecognitionListener).not.toHaveBeenCalled();
    expect(mockSpeechModule.isRecognitionAvailable).not.toHaveBeenCalled();
    expect(mockSpeechModule.start).not.toHaveBeenCalled();
  });

  it('maps network errors to speech recognition failure', async () => {
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    emit('error', { error: 'network', message: 'network failed' });
    emit('end');

    expect(Alert.alert).toHaveBeenCalledWith('Speech recognition failed', expect.any(String));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('maps native permission errors to the permission alert', async () => {
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    emit('error', { error: 'not-allowed', message: 'denied' });
    emit('end');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Voice input permissions needed',
      expect.any(String),
      expect.any(Array),
    );
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('returns to idle when native start throws', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSpeechModule.start.mockImplementationOnce(() => {
      throw new Error('native start failed');
    });
    const { result } = renderVoiceHook();

    await start(result);
    emit('end');

    expect(warnSpy).toHaveBeenCalledWith('Voice input failed to start', expect.any(Error));
    expect(Alert.alert).toHaveBeenCalledWith('Speech recognition failed', expect.any(String));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('maps no-match terminal events to the no-speech alert', async () => {
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    emit('nomatch');
    emit('end');

    expect(Alert.alert).toHaveBeenCalledWith('No speech recognized', expect.any(String));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('silently retries with en-US when the system locale is unsupported, then commits transcript', async () => {
    mockGetLocales.mockReturnValue([{ languageTag: 'zh-CN' } as ReturnType<typeof getLocales>[0]]);
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    // First attempt: iOS reports locale unsupported
    emit('error', { error: 'language-not-supported', message: 'locale not supported' });
    emit('end');

    // Should retry silently with en-US — no alert shown, still recording
    expect(mockSpeechModule.start).toHaveBeenCalledTimes(2);
    expect(mockSpeechModule.start).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lang: 'en-US' }),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(result.current.status).toBe('recording');

    // en-US recognition succeeds
    emit('result', { isFinal: true, results: [{ transcript: 'hello world' }] });
    emit('end');

    expect(onTranscript).toHaveBeenCalledWith('hello world');
    expect(result.current.status).toBe('idle');
  });

  it('shows error alert when en-US fallback also fails with language-not-supported', async () => {
    mockGetLocales.mockReturnValue([{ languageTag: 'zh-CN' } as ReturnType<typeof getLocales>[0]]);
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    // First attempt: locale unsupported → triggers retry
    emit('error', { error: 'language-not-supported', message: 'locale not supported' });
    emit('end');

    // Second attempt (en-US): also fails with language-not-supported → shows alert this time
    emit('error', { error: 'language-not-supported', message: 'en-US also not supported' });
    emit('end');

    expect(Alert.alert).toHaveBeenCalledWith('Language unavailable', expect.any(String));
    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('aborts timed-out recordings and returns to idle', async () => {
    jest.useFakeTimers();
    const onTranscript = jest.fn();
    const { result } = renderVoiceHook({ onTranscript });

    await start(result);
    act(() => {
      jest.advanceTimersByTime(VOICE_INPUT_TIMEOUT_MS);
    });
    emit('error', { error: 'aborted', message: 'aborted' });
    emit('end');

    expect(mockSpeechModule.abort).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('Voice input timed out', expect.any(String));
    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});

import {
  ExpoSpeechRecognitionModule,
  TaskHintIOS,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { getSystemSpeechLocale } from '../utils/voiceInputText';

export const VOICE_INPUT_TIMEOUT_MS = 45_000;

export type VoiceInputStatus =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'transcribing'
  | 'unavailable';

export interface UseVoiceInputOptions {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
}

export interface UseVoiceInputResult {
  status: VoiceInputStatus;
  isAvailable: boolean;
  isBusy: boolean;
  startVoiceInput: () => Promise<void>;
  stopVoiceInput: () => void;
  cancelVoiceInput: () => void;
}

function showPermissionAlert() {
  Alert.alert(
    'Voice input permissions needed',
    'Enable microphone and speech recognition permissions in Settings to use voice input.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}

function showRecognitionUnavailableAlert() {
  Alert.alert(
    'Voice input unavailable',
    'Speech recognition is not available on this device right now.',
  );
}

function showRecognitionFailedAlert() {
  Alert.alert('Speech recognition failed', 'Voice input failed. Please try again.');
}

function messageForError(error: ExpoSpeechRecognitionErrorCode) {
  switch (error) {
    case 'language-not-supported':
      return {
        title: 'Language unavailable',
        message: 'The current system language is not available for speech recognition.',
      };
    case 'no-speech':
    case 'speech-timeout':
      return {
        title: 'No speech recognized',
        message: 'Try again after speaking clearly into the microphone.',
      };
    case 'network':
    case 'audio-capture':
    case 'bad-grammar':
    case 'busy':
    case 'client':
    case 'interrupted':
    case 'unknown':
      return {
        title: 'Speech recognition failed',
        message: 'Voice input failed. Please try again.',
      };
    case 'not-allowed':
    case 'service-not-allowed':
    case 'aborted':
      return null;
  }
}

function isPermissionError(error: ExpoSpeechRecognitionErrorCode) {
  return error === 'not-allowed' || error === 'service-not-allowed';
}

export function useVoiceInput({
  disabled,
  onTranscript,
}: UseVoiceInputOptions): UseVoiceInputResult {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [nativeAvailable, setNativeAvailable] = useState(true);
  const latestTranscriptRef = useRef('');
  const shouldCommitRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const timeoutRequestedRef = useRef(false);
  const handledTerminalEventRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const platformSupported = Platform.OS === 'ios';

  const clearVoiceTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const resetRecognitionRefs = useCallback(() => {
    latestTranscriptRef.current = '';
    shouldCommitRef.current = false;
    cancelRequestedRef.current = false;
    timeoutRequestedRef.current = false;
    handledTerminalEventRef.current = false;
  }, []);

  const showNoSpeechAlert = useCallback(() => {
    handledTerminalEventRef.current = true;
    Alert.alert('No speech recognized', 'Try again after speaking clearly into the microphone.');
  }, []);

  const finishWithoutCommit = useCallback(() => {
    clearVoiceTimeout();
    shouldCommitRef.current = false;
    latestTranscriptRef.current = '';
    setStatus('idle');
  }, [clearVoiceTimeout]);

  const startVoiceTimeout = useCallback(() => {
    clearVoiceTimeout();
    timeoutRef.current = setTimeout(() => {
      timeoutRequestedRef.current = true;
      handledTerminalEventRef.current = true;
      finishWithoutCommit();
      ExpoSpeechRecognitionModule.abort();
      Alert.alert('Voice input timed out', 'Try again after speaking clearly into the microphone.');
    }, VOICE_INPUT_TIMEOUT_MS);
  }, [clearVoiceTimeout, finishWithoutCommit]);

  const startVoiceInput = useCallback(async () => {
    if (!platformSupported || disabled || status !== 'idle') {
      return;
    }

    setStatus('requesting_permission');
    resetRecognitionRefs();

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setNativeAvailable(false);
      setStatus('unavailable');
      showRecognitionUnavailableAlert();
      return;
    }

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus('idle');
        showPermissionAlert();
        return;
      }

      startVoiceTimeout();
      ExpoSpeechRecognitionModule.start({
        lang: getSystemSpeechLocale(),
        interimResults: true,
        continuous: false,
        iosTaskHint: TaskHintIOS.dictation,
      });
      setStatus('recording');
    } catch (error) {
      console.warn('Voice input failed to start', error);
      handledTerminalEventRef.current = true;
      finishWithoutCommit();
      showRecognitionFailedAlert();
    }
  }, [
    disabled,
    finishWithoutCommit,
    platformSupported,
    resetRecognitionRefs,
    startVoiceTimeout,
    status,
  ]);

  const stopVoiceInput = useCallback(() => {
    if (status !== 'recording') {
      return;
    }

    setStatus('transcribing');
    ExpoSpeechRecognitionModule.stop();
  }, [status]);

  const cancelVoiceInput = useCallback(() => {
    if (status !== 'recording' && status !== 'transcribing' && status !== 'requesting_permission') {
      return;
    }

    cancelRequestedRef.current = true;
    finishWithoutCommit();
    ExpoSpeechRecognitionModule.abort();
  }, [finishWithoutCommit, status]);

  useSpeechRecognitionEvent('start', () => {
    if (!cancelRequestedRef.current && !timeoutRequestedRef.current) {
      setStatus('recording');
    }
  });

  useSpeechRecognitionEvent('result', (event: ExpoSpeechRecognitionResultEvent) => {
    if (cancelRequestedRef.current || timeoutRequestedRef.current || !event.isFinal) {
      return;
    }

    const transcript = event.results[0]?.transcript ?? '';
    latestTranscriptRef.current = transcript;
    shouldCommitRef.current = transcript.trim().length > 0;
  });

  useSpeechRecognitionEvent('nomatch', () => {
    shouldCommitRef.current = false;
    latestTranscriptRef.current = '';
    showNoSpeechAlert();
  });

  useSpeechRecognitionEvent('error', (event: ExpoSpeechRecognitionErrorEvent) => {
    clearVoiceTimeout();

    if (event.error === 'aborted' && (cancelRequestedRef.current || timeoutRequestedRef.current)) {
      setStatus('idle');
      return;
    }

    const errorCopy = messageForError(event.error);
    shouldCommitRef.current = false;
    latestTranscriptRef.current = '';
    handledTerminalEventRef.current = true;
    setStatus('idle');

    if (isPermissionError(event.error)) {
      showPermissionAlert();
    } else if (errorCopy) {
      Alert.alert(errorCopy.title, errorCopy.message);
    }
  });

  useSpeechRecognitionEvent('end', () => {
    clearVoiceTimeout();

    if (cancelRequestedRef.current || timeoutRequestedRef.current) {
      setStatus('idle');
      return;
    }

    if (shouldCommitRef.current) {
      onTranscript(latestTranscriptRef.current);
    } else if (!handledTerminalEventRef.current) {
      showNoSpeechAlert();
    }

    setStatus('idle');
    shouldCommitRef.current = false;
    latestTranscriptRef.current = '';
  });

  useEffect(() => clearVoiceTimeout, [clearVoiceTimeout]);

  const isAvailable = platformSupported && nativeAvailable && !disabled;
  const visibleStatus = platformSupported && nativeAvailable ? status : 'unavailable';
  const isBusy =
    visibleStatus === 'requesting_permission' ||
    visibleStatus === 'recording' ||
    visibleStatus === 'transcribing';

  return useMemo(
    () => ({
      status: visibleStatus,
      isAvailable,
      isBusy,
      startVoiceInput,
      stopVoiceInput,
      cancelVoiceInput,
    }),
    [cancelVoiceInput, isAvailable, isBusy, startVoiceInput, stopVoiceInput, visibleStatus],
  );
}

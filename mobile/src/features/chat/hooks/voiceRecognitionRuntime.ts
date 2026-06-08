import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  ExpoSpeechRecognitionNativeEventMap,
  ExpoSpeechRecognitionModule,
  TaskHintIOS,
} from 'expo-speech-recognition';

export interface VoiceRecognitionRuntime {
  ExpoSpeechRecognitionModule: typeof ExpoSpeechRecognitionModule;
  TaskHintIOS: typeof TaskHintIOS;
}

type VoiceRecognitionNativeEvents = {
  [K in keyof ExpoSpeechRecognitionNativeEventMap]: ExpoSpeechRecognitionNativeEventMap[K] extends null
    ? () => void
    : (event: ExpoSpeechRecognitionNativeEventMap[K]) => void;
};

type VoiceRecognitionEventEmitter = {
  addListener<K extends keyof VoiceRecognitionNativeEvents>(
    eventName: K,
    listener: VoiceRecognitionNativeEvents[K],
  ): EventSubscription;
};

function isVoiceRecognitionModule(
  nativeModule: typeof ExpoSpeechRecognitionModule | null,
): nativeModule is typeof ExpoSpeechRecognitionModule {
  return (
    Boolean(nativeModule) &&
    typeof nativeModule?.abort === 'function' &&
    typeof nativeModule.isRecognitionAvailable === 'function' &&
    typeof nativeModule.requestPermissionsAsync === 'function' &&
    typeof nativeModule.start === 'function' &&
    typeof nativeModule.stop === 'function' &&
    typeof (nativeModule as unknown as Partial<VoiceRecognitionEventEmitter>).addListener ===
      'function'
  );
}

export async function loadVoiceRecognitionRuntime(): Promise<VoiceRecognitionRuntime | null> {
  const nativeModule =
    requireOptionalNativeModule<typeof ExpoSpeechRecognitionModule>('ExpoSpeechRecognition');

  if (!isVoiceRecognitionModule(nativeModule)) {
    return null;
  }

  return {
    ExpoSpeechRecognitionModule: nativeModule,
    TaskHintIOS: { dictation: 'dictation' } as typeof TaskHintIOS,
  };
}

export function addVoiceRecognitionListener<K extends keyof ExpoSpeechRecognitionNativeEventMap>(
  runtime: VoiceRecognitionRuntime,
  eventName: K,
  listener: VoiceRecognitionNativeEvents[K],
): EventSubscription {
  const eventEmitter =
    runtime.ExpoSpeechRecognitionModule as unknown as VoiceRecognitionEventEmitter;

  return eventEmitter.addListener(eventName, listener);
}

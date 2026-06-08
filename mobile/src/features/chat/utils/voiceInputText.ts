import { getLocales } from 'expo-localization';

export const CHAT_INPUT_MAX_LENGTH = 4096;
export const DEFAULT_SPEECH_LOCALE = 'en-US';

export function appendVoiceTranscript(
  current: string,
  transcript: string,
  maxLength = CHAT_INPUT_MAX_LENGTH,
): string {
  const cleanTranscript = transcript.trim();

  if (!cleanTranscript) {
    return current;
  }

  const separator = current.length > 0 && !/\s$/.test(current) ? ' ' : '';
  return `${current}${separator}${cleanTranscript}`.slice(0, maxLength);
}

export function getSystemSpeechLocale(): string {
  const locale = getLocales()[0]?.languageTag?.trim();
  return locale || DEFAULT_SPEECH_LOCALE;
}

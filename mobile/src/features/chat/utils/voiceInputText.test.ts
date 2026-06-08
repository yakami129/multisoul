import { getLocales } from 'expo-localization';
import {
  appendVoiceTranscript,
  CHAT_INPUT_MAX_LENGTH,
  DEFAULT_SPEECH_LOCALE,
  getSystemSpeechLocale,
} from './voiceInputText';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(),
}));

const mockGetLocales = getLocales as jest.MockedFunction<typeof getLocales>;

describe('appendVoiceTranscript', () => {
  it('uses the transcript directly when the composer is empty', () => {
    expect(appendVoiceTranscript('', ' hello world ')).toBe('hello world');
  });

  it('adds one separating space when existing text has no trailing whitespace', () => {
    expect(appendVoiceTranscript('hello', 'world')).toBe('hello world');
  });

  it('does not add a second space when existing text already ends with whitespace', () => {
    expect(appendVoiceTranscript('hello ', 'world')).toBe('hello world');
  });

  it('keeps the original input when transcript has no content', () => {
    expect(appendVoiceTranscript('draft text', '   ')).toBe('draft text');
  });

  it('keeps output within the composer character cap', () => {
    const current = 'a'.repeat(CHAT_INPUT_MAX_LENGTH - 2);

    expect(appendVoiceTranscript(current, 'voice')).toHaveLength(CHAT_INPUT_MAX_LENGTH);
  });
});

describe('getSystemSpeechLocale', () => {
  it('uses the first device language tag', () => {
    mockGetLocales.mockReturnValue([
      { languageTag: 'zh-Hant-TW' } as ReturnType<typeof getLocales>[0],
    ]);

    expect(getSystemSpeechLocale()).toBe('zh-Hant-TW');
  });

  it('falls back only when no usable language tag is returned', () => {
    mockGetLocales.mockReturnValue([{ languageTag: '   ' } as ReturnType<typeof getLocales>[0]]);

    expect(getSystemSpeechLocale()).toBe(DEFAULT_SPEECH_LOCALE);
  });
});

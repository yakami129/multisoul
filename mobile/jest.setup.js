jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock react-native-reanimated — v4's own mock.js pulls in native worklets which
// don't initialise in Jest. Provide a minimal hand-rolled mock instead.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');

  const noopAnimation = {
    delay: () => noopAnimation,
    springify: () => noopAnimation,
    duration: () => noopAnimation,
    damping: () => noopAnimation,
    stiffness: () => noopAnimation,
  };

  return {
    __esModule: true,
    default: {
      View: View,
      Text: require('react-native').Text,
      Image: require('react-native').Image,
      ScrollView: require('react-native').ScrollView,
      FlatList: require('react-native').FlatList,
      createAnimatedComponent: (Component) => Component,
    },
    View: View,
    FadeInDown: noopAnimation,
    FadeInUp: noopAnimation,
    FadeIn: noopAnimation,
    FadeOut: noopAnimation,
    SlideInRight: noopAnimation,
    SlideInDown: noopAnimation,
    SlideOutLeft: noopAnimation,
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => fn(),
    withTiming: (v) => v,
    withSpring: (v) => v,
    withDelay: (_d, v) => v,
    withSequence: (...args) => args[args.length - 1],
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    interpolate: (v, _i, _o) => v,
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    createAnimatedComponent: (Component) => Component,
  };
});

// Custom jest setup
// RN 0.81 setup.js uses ESM imports which don't work in Jest's CommonJS environment.
// This file replicates the essential parts using CommonJS.

global.IS_REACT_ACT_ENVIRONMENT = true;
global.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
global.__DEV__ = true;

// Polyfill timers
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);

// Polyfill nativeFabricUIManager
global.nativeFabricUIManager = {};

// Polyfill performance
if (!global.performance) {
  global.performance = { now: () => Date.now() };
}

// Pre-define globals that expo/src/winter/installGlobal.ts would lazily load
// from runtime.native.ts (which uses ESM `import` and fails in setupFiles context).
// Setting configurable: false prevents expo's installGlobal from overwriting them.
if (!global.structuredClone) {
  Object.defineProperty(global, 'structuredClone', {
    value: (obj) => JSON.parse(JSON.stringify(obj)),
    enumerable: true,
    writable: true,
    configurable: false,
  });
}
Object.defineProperty(global, '__ExpoImportMetaRegistry', {
  value: { url: null },
  enumerable: false,
  writable: true,
  configurable: false,
});

// Mock expo-clipboard — not available in Jest environment
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
  getStringAsync: jest.fn().mockResolvedValue(''),
}));

// Mock expo-localization — native module is not available in Jest environment.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'en-US' }]),
}));

// Mock expo-speech-recognition — native module is not available in Jest environment.
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    abort: jest.fn(),
    isRecognitionAvailable: jest.fn(() => false),
    requestPermissionsAsync: jest.fn().mockResolvedValue({
      canAskAgain: false,
      expires: 'never',
      granted: false,
      status: 'denied',
    }),
    start: jest.fn(),
    stop: jest.fn(),
  },
  TaskHintIOS: { dictation: 'dictation' },
  useSpeechRecognitionEvent: jest.fn(),
}));

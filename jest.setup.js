/* global jest */

// Tests inherit the store-safe default. Individual legacy sharing suites must
// opt in explicitly so unrelated coverage cannot mask a missing rollout flag.
delete process.env.EXPO_PUBLIC_SCHEDULE_SHARING_ENABLED;

jest.mock('@react-native-async-storage/async-storage', () => (
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
));

jest.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: {
    Current: 'current',
  },
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true, assets: null }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: null }),
}));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');

  return {
    GestureHandlerRootView: View,
    PanGestureHandler: View,
    State: {
      UNDETERMINED: 0,
      FAILED: 1,
      BEGAN: 2,
      CANCELLED: 3,
      ACTIVE: 4,
      END: 5,
    },
  };
});

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const identity = (value) => value;
  const easingIdentity = (value) => value;

  return {
    __esModule: true,
    default: { View },
    cancelAnimation: jest.fn(),
    Easing: {
      bezier: () => easingIdentity,
      cubic: easingIdentity,
      in: () => easingIdentity,
      inOut: () => easingIdentity,
      linear: easingIdentity,
      out: () => easingIdentity,
    },
    Extrapolation: {
      CLAMP: 'clamp',
      EXTEND: 'extend',
      IDENTITY: 'identity',
    },
    interpolate: (value, inputRange, outputRange) => {
      if (value <= inputRange[0]) {
        return outputRange[0];
      }
      if (value >= inputRange[inputRange.length - 1]) {
        return outputRange[outputRange.length - 1];
      }

      const upperIndex = inputRange.findIndex((input) => input >= value);
      const lowerIndex = Math.max(0, upperIndex - 1);
      const inputSpan = inputRange[upperIndex] - inputRange[lowerIndex];
      const progress = inputSpan === 0
        ? 0
        : (value - inputRange[lowerIndex]) / inputSpan;

      return outputRange[lowerIndex]
        + (outputRange[upperIndex] - outputRange[lowerIndex]) * progress;
    },
    ReduceMotion: {
      Always: 'always',
      Never: 'never',
      System: 'system',
    },
    runOnJS: identity,
    useAnimatedStyle: (factory) => factory(),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: (initialValue) => React.useRef({ value: initialValue }).current,
    withDelay: (_delay, animation) => animation,
    withRepeat: identity,
    withSpring: (value, _config, callback) => {
      callback?.(true);
      return value;
    },
    withTiming: (value, _config, callback) => {
      callback?.(true);
      return value;
    },
  };
});

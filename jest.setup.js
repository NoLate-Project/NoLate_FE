/* global jest */

jest.mock('@react-native-async-storage/async-storage', () => (
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
));

jest.mock('react-native-reanimated', () => {
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
    useSharedValue: (initialValue) => ({ value: initialValue }),
    withDelay: (_delay, animation) => animation,
    withRepeat: identity,
    withSpring: identity,
    withTiming: identity,
  };
});

/* global jest */

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
  const React = require('react');
  const { View } = require('react-native');
  const createGesture = () => {
    const callbacks = {};
    const config = {};
    const gesture = {
      __mockCallbacks: callbacks,
      __mockConfig: config,
    };

    [
      'enabled',
      'minDistance',
      'maxPointers',
      'cancelsTouchesInView',
    ].forEach((method) => {
      gesture[method] = (value) => {
        config[method] = value;
        return gesture;
      };
    });
    gesture.withTestId = (testID) => {
      config.testID = testID;
      return gesture;
    };
    [
      'onTouchesDown',
      'onBegin',
      'onUpdate',
      'onEnd',
      'onFinalize',
    ].forEach((method) => {
      gesture[method] = (callback) => {
        callbacks[method] = callback;
        return gesture;
      };
    });

    return gesture;
  };
  const GestureDetector = ({ gesture, children }) => React.createElement(
    View,
    {
      testID: gesture?.__mockConfig?.testID,
      mockGestureCallbacks: gesture?.__mockCallbacks,
      mockGestureConfig: gesture?.__mockConfig,
    },
    children
  );

  return {
    Gesture: {
      Pan: createGesture,
    },
    GestureDetector,
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
  const pendingTimingCallbacks = [];
  const pendingRunOnJSCallbacks = [];
  let deferTimingCallbacks = false;
  let deferRunOnJSCallbacks = false;
  const withTiming = jest.fn((value, _config, callback) => {
    if (callback) {
      if (deferTimingCallbacks) {
        pendingTimingCallbacks.push(callback);
      } else {
        callback(true);
      }
    }
    return value;
  });
  const runOnJS = (callback) => (...args) => {
    if (deferRunOnJSCallbacks) {
      pendingRunOnJSCallbacks.push(() => callback(...args));
      return undefined;
    }
    return callback(...args);
  };

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
    runOnJS,
    useAnimatedStyle: (factory) => {
      const style = factory();
      Object.defineProperty(style, '__mockFactory', {
        configurable: true,
        enumerable: false,
        value: factory,
      });
      return style;
    },
    useReducedMotion: jest.fn(() => false),
    useSharedValue: (initialValue) => React.useRef({ value: initialValue }).current,
    withDelay: (_delay, animation) => animation,
    withRepeat: identity,
    withSpring: (value, _config, callback) => {
      callback?.(true);
      return value;
    },
    withTiming,
    __setTimingCallbacksDeferred: (deferred) => {
      deferTimingCallbacks = deferred;
    },
    __flushTimingCallbacks: (finished = true) => {
      const callbacks = pendingTimingCallbacks.splice(
        0,
        pendingTimingCallbacks.length
      );
      callbacks.forEach((callback) => callback(finished));
    },
    __resetTimingCallbacks: () => {
      deferTimingCallbacks = false;
      pendingTimingCallbacks.splice(0, pendingTimingCallbacks.length);
      deferRunOnJSCallbacks = false;
      pendingRunOnJSCallbacks.splice(0, pendingRunOnJSCallbacks.length);
    },
    __getPendingTimingCallbackCount: () => pendingTimingCallbacks.length,
    __setRunOnJSCallbacksDeferred: (deferred) => {
      deferRunOnJSCallbacks = deferred;
    },
    __flushRunOnJSCallbacks: () => {
      const callbacks = pendingRunOnJSCallbacks.splice(
        0,
        pendingRunOnJSCallbacks.length
      );
      callbacks.forEach((callback) => callback());
    },
    __getPendingRunOnJSCallbackCount: () => pendingRunOnJSCallbacks.length,
  };
});

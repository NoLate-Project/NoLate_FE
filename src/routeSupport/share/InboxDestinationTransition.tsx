import { useNavigation, usePreventRemove, type NavigationAction } from '@react-navigation/native';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { useSystemReduceMotion } from '../../modules/performance/useSystemReduceMotion';
import { playNotificationInboxReturn } from './notificationInboxReturn';

const OFFSET = 12;
const OPEN_MS = 240;
const CLOSE_MS = 180;

type InboxDestinationTransitionProps = React.PropsWithChildren<{
  source: 'share' | 'notification';
  editing?: boolean;
  notificationInboxKey?: string;
}>;

export default function InboxDestinationTransition({
  children, source, editing = false, notificationInboxKey,
}: InboxDestinationTransitionProps) {
  const navigation = useNavigation();
  const reduceMotion = useSystemReduceMotion();
  const position = useRef(new Animated.Value(reduceMotion ? 0 : OFFSET)).current;
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : source === 'notification' ? 0.74 : 0.7)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const pendingBack = useRef<NavigationAction | null>(null);
  const [closing, setClosing] = useState(false);

  useLayoutEffect(() => {
    if (reduceMotion) {
      position.setValue(0);
      opacity.setValue(1);
      const action = pendingBack.current;
      if (action) {
        pendingBack.current = null;
        navigation.dispatch(action);
      }
    } else {
      const options = { duration: OPEN_MS, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true, isInteraction: false };
      animation.current = Animated.parallel([
        Animated.timing(position, { ...options, toValue: 0 }),
        Animated.timing(opacity, { ...options, toValue: 1 }),
      ]);
      animation.current.start();
    }
    return () => animation.current?.stop();
  }, [navigation, opacity, position, reduceMotion]);

  usePreventRemove((source === 'share' || !!notificationInboxKey) && !editing && !reduceMotion, ({ data: { action } }) => {
    if (pendingBack.current) return;
    pendingBack.current = action;
    setClosing(true);
    animation.current?.stop();
    const finish = () => {
      if (pendingBack.current !== action) return;
      pendingBack.current = null;
      navigation.dispatch(action);
    };
    if (source === 'notification' && notificationInboxKey) {
      // The transparent destination keeps the source mounted through its return motion.
      opacity.setValue(0);
      playNotificationInboxReturn(notificationInboxKey, finish);
      return;
    }
    const options = { duration: CLOSE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true, isInteraction: false };
    animation.current = Animated.parallel([
      Animated.timing(position, { ...options, toValue: OFFSET }),
      Animated.timing(opacity, { ...options, toValue: 0 }),
    ]);
    animation.current.start(({ finished }) => {
      if (finished) finish();
    });
  });

  return (
    <Animated.View accessibilityViewIsModal accessibilityElementsHidden={closing}
      pointerEvents={closing ? 'none' : 'auto'}
      style={[styles.scene, { opacity, transform: [{ translateX: position }] }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ scene: { flex: 1 } });

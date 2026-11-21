import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import type { Dispatch, SetStateAction } from 'react';

import { useSystemReduceMotion } from '../../../performance/useSystemReduceMotion';
import {
  isDateType,
  pickerTargetH,
  type PickerType,
} from './scheduleAddModalModel';

type Params = {
  picker: PickerType | null;
  setDisplayPicker: Dispatch<SetStateAction<PickerType | null>>;
};

/** 날짜·시간 피커를 전환하며 중단된 전환이 이전 콘텐츠를 복원하지 않도록 관리합니다. */
export function useScheduleAddPickerAnimation({
  picker,
  setDisplayPicker,
}: Params) {
  const reduceMotion = useSystemReduceMotion();
  const heightAnim = useRef(new Animated.Value(0)).current;
  const outerOpacity = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(1)).current;
  const displayedPickerRef = useRef<PickerType | null>(null);

  useEffect(() => {
    let cancelled = false;
    const showPicker = (next: PickerType | null) => {
      displayedPickerRef.current = next;
      setDisplayPicker(next);
    };
    const stopTransition = () => {
      cancelled = true;
      heightAnim.stopAnimation();
      outerOpacity.stopAnimation();
      contentFade.stopAnimation();
    };
    const revealPicker = () => {
      if (cancelled || picker === null) return;
      showPicker(picker);
      Animated.parallel([
        Animated.spring(heightAnim, {
          toValue: pickerTargetH(picker),
          useNativeDriver: false,
          damping: 18,
          stiffness: 160,
          mass: 0.8,
        }),
        Animated.timing(outerOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(contentFade, {
          toValue: 1,
          duration: 220,
          useNativeDriver: false,
        }),
      ]).start();
    };

    if (reduceMotion || (picker === null && displayedPickerRef.current === null)) {
      heightAnim.setValue(picker ? pickerTargetH(picker) : 0);
      outerOpacity.setValue(picker ? 1 : 0);
      contentFade.setValue(1);
      showPicker(picker);
      return stopTransition;
    }

    if (picker === null) {
      Animated.parallel([
        Animated.timing(heightAnim, {
          toValue: 0,
          duration: 220,
          useNativeDriver: false,
        }),
        Animated.timing(outerOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: false,
        }),
      ]).start(({ finished }) => {
        if (finished && !cancelled) {
          showPicker(null);
          contentFade.setValue(1);
        }
      });
    } else if (displayedPickerRef.current !== null &&
      isDateType(picker) !== isDateType(displayedPickerRef.current)) {
      Animated.timing(contentFade, {
        toValue: 0,
        duration: 120,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) revealPicker();
      });
    } else {
      contentFade.setValue(1);
      revealPicker();
    }

    return stopTransition;
  }, [picker, contentFade, heightAnim, outerOpacity, reduceMotion, setDisplayPicker]);

  return { contentFade, heightAnim, outerOpacity };
}

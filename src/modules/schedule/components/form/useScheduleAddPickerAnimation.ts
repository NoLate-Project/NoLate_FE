import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import type { Dispatch, SetStateAction } from 'react';

import {
  isDateType,
  pickerTargetH,
  type PickerType,
} from './scheduleAddModalModel';

type Params = {
  picker: PickerType | null;
  setDisplayPicker: Dispatch<SetStateAction<PickerType | null>>;
};

/**
 * 날짜·시간 피커가 열리고 닫히거나 종류가 바뀔 때 높이와 투명도 전환을 관리합니다.
 * 실제 선택 상태와 애니메이션 중 표시 상태를 분리해 콘텐츠가 중간 프레임에서 바뀌지 않게 합니다.
 */
export function useScheduleAddPickerAnimation({
  picker,
  setDisplayPicker,
}: Params) {
  // 날짜/시간 피커의 높이와 투명도 전환을 관리한다.
  const heightAnim = useRef(new Animated.Value(0)).current;
  const outerOpacity = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(1)).current;
  const prevPickerRef = useRef<PickerType | null>(null);

  useEffect(() => {
    const prev = prevPickerRef.current;
    prevPickerRef.current = picker;

    if (picker !== null && prev === null) {
      // 피커를 처음 열 때 높이와 투명도를 함께 올린다.
      setDisplayPicker(picker);
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
      ]).start();
    } else if (picker === null && prev !== null) {
      // 피커를 닫을 때 컨테이너 높이를 접는다.
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
        if (finished) setDisplayPicker(null);
      });
    } else if (picker !== null && prev !== null) {
      if (isDateType(picker) !== isDateType(prev)) {
        // 날짜 피커와 시간 피커가 바뀔 때 콘텐츠를 페이드 전환한다.
        Animated.timing(contentFade, {
          toValue: 0,
          duration: 120,
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (!finished) return;
          setDisplayPicker(picker);
          Animated.parallel([
            Animated.spring(heightAnim, {
              toValue: pickerTargetH(picker),
              useNativeDriver: false,
              damping: 18,
              stiffness: 160,
              mass: 0.8,
            }),
            Animated.timing(contentFade, {
              toValue: 1,
              duration: 220,
              useNativeDriver: false,
            }),
          ]).start();
        });
      } else {
        // 시작/종료처럼 같은 타입끼리는 내용만 교체한다.
        setDisplayPicker(picker);
      }
    }
  }, [picker, contentFade, heightAnim, outerOpacity, setDisplayPicker]);
  return { contentFade, heightAnim, outerOpacity };
}

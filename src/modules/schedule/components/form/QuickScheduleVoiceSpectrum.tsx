import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_ATTACK_MS,
  VOICE_SPECTRUM_HALO_ATTACK_MS,
  VOICE_SPECTRUM_HALO_RELEASE_MS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_MOTION_EASING,
  VOICE_SPECTRUM_RELEASE_MS,
  VOICE_SPECTRUM_SIZE,
} from "./quickScheduleModalModel";

type VoiceSpectrumBarProps = {
  angle: string;
  color: string;
  level: number;
};

/** 음량 변화에 맞춰 원형 파형의 막대 하나를 부드럽게 늘이고 줄인다. */
export function VoiceSpectrumBar({
  angle,
  color,
  level,
}: VoiceSpectrumBarProps) {
  const normalizedLevel = Math.max(0, Math.min(1, level));
  const animatedLevel = useSharedValue(normalizedLevel);
  const previousLevelRef = useRef(normalizedLevel);

  useEffect(() => {
    const rising = normalizedLevel >= previousLevelRef.current;
    previousLevelRef.current = normalizedLevel;
    animatedLevel.value = withTiming(normalizedLevel, {
      duration: rising
        ? VOICE_SPECTRUM_ATTACK_MS
        : VOICE_SPECTRUM_RELEASE_MS,
      easing: VOICE_SPECTRUM_MOTION_EASING,
    });
  }, [animatedLevel, normalizedLevel]);

  const animatedStyle = useAnimatedStyle(() => {
    const height = Math.max(3, Math.min(20, 3 + animatedLevel.value * 17));
    return {
      height,
      opacity: 0.3 + animatedLevel.value * 0.7,
    };
  });

  return (
    <View
      testID="quick-schedule-voice-spectrum-bar"
      style={[styles.voiceSpectrumBarSlot, { transform: [{ rotate: angle }] }]}
    >
      <Reanimated.View
        style={[
          styles.voiceSpectrumBar,
          { backgroundColor: color, shadowColor: color },
          animatedStyle,
        ]}
      />
    </View>
  );
}

/** 현재 음성 에너지에 따라 원형 파형 뒤의 두 겹 후광을 확대하고 흐리게 표시한다. */
export function VoiceSpectrumHalo({ energy }: { energy: number }) {
  const normalizedEnergy = Math.max(0, Math.min(1, energy));
  const animatedEnergy = useSharedValue(normalizedEnergy);
  const previousEnergyRef = useRef(normalizedEnergy);

  useEffect(() => {
    const rising = normalizedEnergy >= previousEnergyRef.current;
    previousEnergyRef.current = normalizedEnergy;
    animatedEnergy.value = withTiming(normalizedEnergy, {
      duration: rising
        ? VOICE_SPECTRUM_HALO_ATTACK_MS
        : VOICE_SPECTRUM_HALO_RELEASE_MS,
      easing: VOICE_SPECTRUM_MOTION_EASING,
    });
  }, [animatedEnergy, normalizedEnergy]);

  const outerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 0.1 + animatedEnergy.value * 0.2,
    transform: [{ scale: 1 + animatedEnergy.value * 0.1 }],
  }));
  const innerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + animatedEnergy.value * 0.24,
    transform: [{ scale: 1 + animatedEnergy.value * 0.055 }],
  }));

  return (
    <>
      <Reanimated.View
        pointerEvents="none"
        style={[styles.voiceSpectrumHaloOuter, outerAnimatedStyle]}
      />
      <Reanimated.View
        pointerEvents="none"
        style={[styles.voiceSpectrumHaloInner, innerAnimatedStyle]}
      />
    </>
  );
}

const styles = createQuickScheduleModalStyles({
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
});

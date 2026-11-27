import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { ReduceMotion, withTiming } from "react-native-reanimated";

import { useSystemReduceMotion } from "../../../performance/useSystemReduceMotion";
import NoLateLoadingMark from "../../../../ui/NoLateLoadingMark";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  QUICK_ANALYSIS_MOTION,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
} from "./quickScheduleModalModel";

type StatusColors = {
  textPrimary: string;
  textSecondary: string;
};

type LoadingStepProps = {
  colors: StatusColors;
  label: string;
  description?: string;
  isAnalyzing: boolean;
};

/** 분석과 저장에 같은 로고 모션을 사용하고, 저장할 때는 일정 이름을 표시한다. */
export function QuickScheduleLoadingStep({
  colors,
  label,
  description,
  isAnalyzing,
}: LoadingStepProps) {
  const { logoDelayMs, logoSettleMs } = QUICK_ANALYSIS_MOTION;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={description && description !== label ? `${label}. ${description}` : label}
      accessibilityLiveRegion="polite"
      testID="quick-schedule-loading"
      style={styles.centerFlow}
    >
      <NoLateLoadingMark size={82} delayMs={isAnalyzing ? logoDelayMs : 0} durationMs={logoSettleMs} />
      {description ? (
        <Text
          lineBreakStrategyIOS="hangul-word"
          numberOfLines={description === label ? undefined : 2}
          style={[styles.flowHeadline, { color: colors.textPrimary }]}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}

type ErrorStepProps = {
  cardBorderColor: string;
  colors: StatusColors;
  inputBackground: string;
  onEdit: () => void;
  onRetry: () => void;
  retainedInput: string;
  submitting: boolean;
  warningTextColor: string;
};

/** 같은 미리보기 안에서 입력 내용을 확인하고 실패를 복구한다. */
export function QuickScheduleErrorStep({
  cardBorderColor,
  colors,
  inputBackground,
  onEdit,
  onRetry,
  retainedInput,
  submitting,
  warningTextColor,
}: ErrorStepProps) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  return (
    <View style={recoveryStyles.container}>
      <ScrollView style={recoveryStyles.body} contentContainerStyle={recoveryStyles.content}>
        <View style={recoveryStyles.heading}>
          <Ionicons accessible={false} name="warning-outline" size={22} color={warningTextColor} />
          <Text
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            lineBreakStrategyIOS="hangul-word"
            maxFontSizeMultiplier={2.35}
            style={[recoveryStyles.title, { color: colors.textPrimary }]}
          >
            일정을 확인하지 못했어요
          </Text>
        </View>
        {retainedInput ? (
          <View style={[recoveryStyles.source, { backgroundColor: inputBackground }]}>
            <Text style={[recoveryStyles.label, { color: colors.textSecondary }]}>입력한 내용</Text>
            <Text lineBreakStrategyIOS="hangul-word" style={[recoveryStyles.input, { color: colors.textPrimary }]}>
              {retainedInput}
            </Text>
          </View>
        ) : (
          <Text style={[recoveryStyles.input, { color: colors.textSecondary }]}>
            다시 시도하거나 입력을 확인해 주세요.
          </Text>
        )}
      </ScrollView>
      <View style={recoveryStyles.actions}>
        <Pressable
          onPress={onRetry}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="일정 만들기 다시 시도"
          accessibilityState={{ disabled: submitting, busy: submitting }}
          style={({ pressed }) => [styles.submitButton, largeText && styles.submitButtonLarge, { opacity: pressed || submitting ? 0.78 : 1 }]}
        >
          <Text style={styles.submitText}>{submitting ? "확인 중" : "다시 시도"}</Text>
        </Pressable>
        <Pressable
          onPress={onEdit}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="빠른 일정 입력 수정"
          accessibilityState={{ disabled: submitting }}
          style={({ pressed }) => [
            styles.secondaryButton,
            recoveryStyles.editAction,
            largeText && styles.submitButtonLarge,
            { borderColor: cardBorderColor, opacity: pressed || submitting ? 0.72 : 1 },
          ]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>입력 수정</Text>
        </Pressable>
      </View>
    </View>
  );
}

const recoveryStyles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  body: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: 10, gap: 14 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "700" },
  source: { borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, gap: 4 },
  label: { fontSize: 12, fontWeight: "600" },
  input: { fontSize: 14 },
  actions: { gap: 8, paddingTop: 10 },
  editAction: { flex: 0 },
});

type SavedStepProps = {
  colors: StatusColors;
  dateLabel?: string;
  onClose: () => void;
  successColor: string;
  timeLabel?: string;
  title?: string;
};

const savedCheckEntrance = () => {
  "worklet";
  const timing = { duration: 180, reduceMotion: ReduceMotion.System };
  return {
    initialValues: { opacity: 0, transform: [{ perspective: 360 }, { rotateY: "-18deg" }, { scale: 0.88 }] },
    animations: {
      opacity: withTiming(1, timing),
      transform: [{ perspective: 360 }, { rotateY: withTiming("0deg", timing) }, { scale: withTiming(1, timing) }],
    },
  };
};

/** 저장 완료 상태와 캘린더로 돌아가는 단일 완료 동작을 표시한다. */
export function QuickScheduleSavedStep({
  colors,
  dateLabel,
  onClose,
  successColor,
  timeLabel,
  title,
}: SavedStepProps) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  const reduceMotion = useSystemReduceMotion();
  return (
    <View style={recoveryStyles.container}>
      <ScrollView style={recoveryStyles.body} contentContainerStyle={savedStyles.content}>
        <Reanimated.View entering={reduceMotion ? undefined : savedCheckEntrance} style={savedStyles.check}>
          <Ionicons accessible={false} name="checkmark-outline" size={32} color={successColor} />
        </Reanimated.View>
        {title ? <Text lineBreakStrategyIOS="hangul-word" style={[savedStyles.title, { color: colors.textPrimary }]}>{title}</Text> : null}
        {dateLabel ? <Text style={[savedStyles.meta, { color: colors.textSecondary }]}>{dateLabel}</Text> : null}
        {timeLabel ? <Text style={[savedStyles.meta, { color: colors.textSecondary }]}>{timeLabel}</Text> : null}
      </ScrollView>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        style={({ pressed }) => [styles.submitButton, largeText && styles.submitButtonLarge, { opacity: pressed ? 0.78 : 1 }]}
      >
        <Text maxFontSizeMultiplier={2.35} style={styles.submitText}>캘린더에서 보기</Text>
      </Pressable>
    </View>
  );
}

const savedStyles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingVertical: 16, gap: 6 },
  check: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(34,197,94,0.15)", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  meta: { fontSize: 14, textAlign: "center" },
});

const styles = createQuickScheduleModalStyles({
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
});

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

import QuickScheduleLogoLoader from "./QuickScheduleLogoLoader";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
} from "./quickScheduleModalModel";

type StatusColors = {
  textPrimary: string;
  textSecondary: string;
};

type LoadingStepProps = {
  caption: string;
  colors: StatusColors;
  headline: string;
};

/** 분석 또는 저장이 진행되는 동안 브랜드 로더와 현재 작업 설명을 표시한다. */
export function QuickScheduleLoadingStep({
  caption,
  colors,
  headline,
}: LoadingStepProps) {
  return (
    <View style={styles.centerFlow}>
      <QuickScheduleLogoLoader accessibilityLabel={`${headline}. ${caption}`} />
      <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>
        {headline}
      </Text>
      <Text style={[styles.flowCaption, { color: colors.textSecondary }]}>
        {caption}
      </Text>
    </View>
  );
}

type ErrorStepProps = {
  cardBorderColor: string;
  colors: StatusColors;
  errorMessage: string;
  inputBackground: string;
  onEdit: () => void;
  onRetry: () => void;
  submitting: boolean;
  warningBackground: string;
  warningTextColor: string;
};

/** 분석 실패 이유와 입력 수정·재시도 동작을 한 화면에 제공한다. */
export function QuickScheduleErrorStep({
  cardBorderColor,
  colors,
  errorMessage,
  inputBackground,
  onEdit,
  onRetry,
  submitting,
  warningBackground,
  warningTextColor,
}: ErrorStepProps) {
  return (
    <View style={styles.centerFlow}>
      <View style={[styles.statusIconWrap, { backgroundColor: warningBackground }]}>
        <Ionicons accessible={false} name="warning-outline" size={42} color={warningTextColor} />
      </View>
      <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>일정을 만들지 못했어요</Text>
      <Text numberOfLines={2} style={[styles.flowCaption, { color: colors.textSecondary }]}>
        {errorMessage || "입력 내용을 확인한 뒤 다시 시도해 주세요"}
      </Text>
      <View style={styles.savedButtonStack}>
        <Pressable
          onPress={onEdit}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="빠른 일정 입력 수정"
          style={({ pressed }) => [styles.secondaryButton, { flex: 0, alignSelf: "stretch", backgroundColor: inputBackground, borderColor: cardBorderColor, opacity: pressed ? 0.72 : 1 }]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>입력 수정</Text>
        </Pressable>
        <Pressable
          onPress={onRetry}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="일정 만들기 다시 시도"
          style={({ pressed }) => [styles.submitButton, { alignSelf: "stretch", opacity: pressed ? 0.78 : 1 }]}
        >
          <Text style={styles.submitText}>다시 시도</Text>
        </Pressable>
      </View>
    </View>
  );
}

type SavedStepProps = {
  colors: StatusColors;
  dateLabel?: string;
  onClose: () => void;
  successColor: string;
};

/** 저장 완료 상태와 캘린더로 돌아가는 단일 완료 동작을 표시한다. */
export function QuickScheduleSavedStep({
  colors,
  dateLabel,
  onClose,
  successColor,
}: SavedStepProps) {
  return (
    <View style={styles.centerFlow}>
      <View style={[styles.statusIconWrap, { backgroundColor: "rgba(34,197,94,0.15)" }]}>
        <Ionicons accessible={false} name="checkmark" size={46} color={successColor} />
      </View>
      <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>일정이 저장됐어요</Text>
      <View style={styles.savedButtonStack}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.submitButton, { alignSelf: "stretch", opacity: pressed ? 0.78 : 1 }]}
        >
          <Text style={styles.submitText}>{dateLabel ? `${dateLabel} 일정 보기` : "캘린더에서 보기"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = createQuickScheduleModalStyles({
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
});

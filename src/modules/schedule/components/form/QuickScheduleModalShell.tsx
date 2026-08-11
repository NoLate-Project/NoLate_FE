import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Reanimated from "react-native-reanimated";

import CategoryLoadErrorBanner from "./CategoryLoadErrorBanner";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
  type FlowStep,
} from "./quickScheduleModalModel";

type ShellColors = {
  border: string;
  surface2: string;
  textPrimary: string;
  textSecondary: string;
};

type QuickScheduleModalShellProps = {
  backdropAnimatedStyle: StyleProp<ViewStyle>;
  cardBorderColor: string;
  cardClipRadiusStyle: StyleProp<ViewStyle>;
  cardDenseCloseStyle: StyleProp<ViewStyle>;
  cardMotionRadiusStyle: StyleProp<ViewStyle>;
  cardMotionStyle: StyleProp<ViewStyle>;
  cardRasterized: boolean;
  cardSurfaceBackground: string;
  categoryError?: string | null;
  categoryLoading: boolean;
  colors: ShellColors;
  contentMounted: boolean;
  contentRevealCurtainAnimatedStyle: StyleProp<ViewStyle>;
  currentStep: React.ReactNode;
  flowStep: FlowStep;
  flowTitle: string;
  inputModeDescription: string;
  isPrewarmOnly: boolean;
  mode: string;
  onCancelEditField: () => void;
  onRequestClose: () => void;
  onRetryCategories?: () => void;
  onSeedLayout: (event: LayoutChangeEvent) => void;
  presentationStyle: StyleProp<ViewStyle>;
  submitting: boolean;
};

/** 빠른 일정의 배경, 모프 카드, 공통 헤더와 현재 단계 화면을 조립한다. */
export function QuickScheduleModalShell({
  backdropAnimatedStyle,
  cardBorderColor,
  cardClipRadiusStyle,
  cardDenseCloseStyle,
  cardMotionRadiusStyle,
  cardMotionStyle,
  cardRasterized,
  cardSurfaceBackground,
  categoryError,
  categoryLoading,
  colors,
  contentMounted,
  contentRevealCurtainAnimatedStyle,
  currentStep,
  flowStep,
  flowTitle,
  inputModeDescription,
  isPrewarmOnly,
  mode,
  onCancelEditField,
  onRequestClose,
  onRetryCategories,
  onSeedLayout,
  presentationStyle,
  submitting,
}: QuickScheduleModalShellProps) {
  return (
    <Reanimated.View
      pointerEvents={isPrewarmOnly ? "none" : "box-none"}
      style={[styles.screen, presentationStyle]}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal
        accessibilityElementsHidden={isPrewarmOnly}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        importantForAccessibility={isPrewarmOnly ? "no-hide-descendants" : "auto"}
        pointerEvents={isPrewarmOnly ? "none" : "box-none"}
        style={styles.screenContent}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.backdrop,
            backdropAnimatedStyle,
            {
              backgroundColor:
                mode === "dark" ? "rgba(0,0,0,0.58)" : "rgba(0,0,0,0.30)",
            },
          ]}
        />
        <Pressable
          testID="quick-schedule-backdrop"
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={onRequestClose}
        />

        <Reanimated.View
          collapsable={false}
          onLayout={onSeedLayout}
          style={[styles.cardMotion, cardMotionStyle, cardMotionRadiusStyle]}
        >
          <Reanimated.View style={[styles.cardClip, cardClipRadiusStyle, shellStyles.transparentSurface]}>
            <Reanimated.View
              collapsable={false}
              shouldRasterizeIOS={Platform.OS === "ios" && cardRasterized}
              style={[
                styles.card,
                cardDenseCloseStyle,
                {
                  backgroundColor: cardSurfaceBackground,
                  borderColor: cardBorderColor,
                },
              ]}
            >
              <View style={styles.content}>
                {contentMounted && (
                  <>
                    <View style={[styles.closeButton, { backgroundColor: colors.surface2 }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="빠른 일정 등록 닫기"
                        accessibilityState={{
                          disabled: submitting && flowStep !== "analyzing",
                          busy: submitting,
                        }}
                        disabled={submitting && flowStep !== "analyzing"}
                        onPress={onRequestClose}
                        hitSlop={10}
                        style={({ pressed }) => [styles.closeButtonPressable, { opacity: pressed ? 0.58 : 1 }]}
                      >
                        <Ionicons accessible={false} name="close" size={22} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                    <View style={[styles.header, flowStep !== "input" && styles.headerCentered, (flowStep === "preview" || flowStep === "edit") && styles.flowHeader]}>
                      {flowStep === "edit" && (
                        <Pressable accessibilityRole="button" accessibilityLabel="일정 미리보기로 돌아가기" onPress={onCancelEditField} hitSlop={10} style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.58 : 1 }]}>
                          <Ionicons accessible={false} name="chevron-back" size={22} color={colors.textSecondary} />
                        </Pressable>
                      )}
                      <Text style={[styles.title, (flowStep === "preview" || flowStep === "edit") && styles.flowHeaderTitle, { color: colors.textPrimary }]}>{flowTitle}</Text>
                      {flowStep === "input" && <Text style={[styles.headerDescription, { color: colors.textSecondary }]}>{inputModeDescription}</Text>}
                    </View>
                    {categoryError && onRetryCategories ? (
                      <CategoryLoadErrorBanner compact retrying={categoryLoading} onRetry={onRetryCategories} />
                    ) : null}
                    <View style={styles.handoffBody}>{currentStep}</View>
                  </>
                )}
              </View>
            </Reanimated.View>
            <Reanimated.View pointerEvents="none" style={[styles.contentRevealCurtain, contentRevealCurtainAnimatedStyle, { backgroundColor: cardSurfaceBackground }]} />
          </Reanimated.View>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </Reanimated.View>
  );
}

const styles = createQuickScheduleModalStyles({
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
});
const shellStyles = StyleSheet.create({
  transparentSurface: { backgroundColor: "transparent" },
});

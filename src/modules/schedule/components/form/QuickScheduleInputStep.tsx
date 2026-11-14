import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, type RefObject } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import Reanimated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import BrandedLoader from "../../../../ui/BrandedLoader";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import QuickSchedulePhotoScanEffect from "./QuickSchedulePhotoScanEffect";
import { VoiceSpectrumBar, VoiceSpectrumHalo } from "./QuickScheduleVoiceSpectrum";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  INPUT_MODES,
  QUICK_TEXT_LIMIT,
  VOICE_SPECTRUM_BARS,
  VOICE_SPECTRUM_BAR_COUNT,
  VOICE_SPECTRUM_COLORS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SAMPLE_COUNT,
  VOICE_SPECTRUM_SIZE,
  placeholderForMode,
  type FlowStep,
  type InputMode,
} from "./quickScheduleModalModel";

type QuickScheduleInputColors = {
  border: string;
  inputBorder: string;
  inputBorderFocused: string;
  inputPlaceholder: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
};

const photoTextEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

type QuickScheduleInputStepProps = {
  canSubmit: boolean;
  cardBorderColor: string;
  colors: QuickScheduleInputColors;
  flowStep: FlowStep;
  handleModeLayout: (
    key: InputMode,
  ) => (event: LayoutChangeEvent) => void;
  handleModePress: (mode: InputMode) => void;
  inputBackground: string;
  inputMode: InputMode;
  inputRef: RefObject<TextInput | null>;
  isPhotoRecognizing: boolean;
  isVoiceFinalizing: boolean;
  keyboardVisible: boolean;
  mediaPanelBackground: string;
  mode: string;
  modeIndicatorAnimatedStyle: StyleProp<ViewStyle>;
  onPhotoActionSheet: () => void;
  onPhotoRecognitionRetry: () => void;
  onPhotoTranscriptChange: (value: string) => void;
  onRemovePhoto: () => void;
  onStartVoiceRecording: () => void;
  onStopVoiceRecording: () => void;
  onSubmit: () => void;
  onVoiceTranscriptChange: (value: string) => void;
  photoErrorBorder: string;
  photoErrorSurface: string;
  photoErrorTextColor: string;
  photoErrorTitleColor: string;
  photoNeedsReview: boolean;
  photoRecognitionError: string;
  photoScanFrameStyle: StyleProp<ViewStyle>;
  photoTranscript: string;
  photoTranscriptTruncated: boolean;
  segmentedBackground: string;
  selectedModeBackground: string;
  selectedPhoto: ImagePickerAsset | null;
  submitting: boolean;
  showSubmitProgress?: boolean;
  text: string;
  setText: (value: string) => void;
  voiceControlMeta: string;
  voiceControlTitle: string;
  voiceDurationMillis: number;
  voiceMeterHistory: number[];
  voiceSpectrumEnergy: number;
  voiceTranscript: string;
  voiceTranscriptTruncated: boolean;
  voiceUri: string | null;
  isVoiceRecording: boolean;
};

/** 빠른 일정의 텍스트·사진·음성 입력 탭과 공통 제출 버튼을 표시한다. */
export function QuickScheduleInputStep({
  canSubmit,
  cardBorderColor,
  colors,
  flowStep,
  handleModeLayout,
  handleModePress,
  inputBackground,
  inputMode,
  inputRef,
  isPhotoRecognizing,
  isVoiceFinalizing,
  keyboardVisible,
  mediaPanelBackground,
  mode,
  modeIndicatorAnimatedStyle,
  onPhotoActionSheet,
  onPhotoRecognitionRetry,
  onPhotoTranscriptChange,
  onRemovePhoto,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onSubmit,
  onVoiceTranscriptChange,
  photoErrorBorder,
  photoErrorSurface,
  photoErrorTextColor,
  photoErrorTitleColor,
  photoNeedsReview,
  photoRecognitionError,
  photoScanFrameStyle,
  photoTranscript,
  photoTranscriptTruncated,
  segmentedBackground,
  selectedModeBackground,
  selectedPhoto,
  submitting,
  showSubmitProgress = true,
  text,
  setText,
  voiceControlMeta,
  voiceControlTitle,
  voiceMeterHistory,
  voiceSpectrumEnergy,
  voiceTranscript,
  voiceTranscriptTruncated,
  voiceUri,
  isVoiceRecording,
}: QuickScheduleInputStepProps) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  const modePanelEntry = useMemo(() => largeText ? FadeIn.duration(140).reduceMotion(ReduceMotion.System) : undefined, [largeText]);
  const scrollRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null!);
  const scrollOffset = useRef(0);

  const revealFocusedInput = ({ nativeEvent }: LayoutChangeEvent) => {
    if (!keyboardVisible || nativeEvent.layout.height <= 0) return;
    const focusedInput = TextInput.State.currentlyFocusedInput();
    const content = scrollContentRef.current;
    if (!focusedInput || !content) return;

    const viewportHeight = nativeEvent.layout.height;
    focusedInput.measureLayout(content, (_left, top, _width, height) => {
      if (TextInput.State.currentlyFocusedInput() !== focusedInput) return;
      const targetOffset = top + Math.min(height, viewportHeight - 8) + 8 - viewportHeight;
      if (targetOffset > scrollOffset.current) {
        scrollRef.current?.scrollTo({ y: targetOffset, animated: false });
      }
    });
  };
  const modeSelector = (
    <View
      style={[
        styles.modeSelector,
        largeText && styles.modeSelectorLarge,
        {
          backgroundColor: segmentedBackground,
          borderColor: cardBorderColor,
        },
      ]}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[
          styles.modeSelectorIndicator,
          {
            backgroundColor: selectedModeBackground,
            borderColor: cardBorderColor,
          },
          modeIndicatorAnimatedStyle,
        ]}
      />
      {INPUT_MODES.map(item => {
        const selected = item.key === inputMode;
        return (
          <Pressable
            key={item.key}
            onLayout={handleModeLayout(item.key)}
            onPress={() => handleModePress(item.key)}
            disabled={
              submitting || isVoiceFinalizing || flowStep !== "input"
            }
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel}
            accessibilityState={{
              selected,
              disabled:
                submitting || isVoiceFinalizing || flowStep !== "input",
            }}
            style={({ pressed }) => [
              styles.modeButton,
              largeText && styles.modeButtonLarge,
              selected && styles.modeButtonSelected,
              { opacity: pressed ? 0.7 : submitting ? 0.48 : 1 },
            ]}
          >
            <Ionicons
              accessible={false}
              name={item.icon}
              size={17}
              color={selected ? BLUE : colors.textSecondary}
            />
            <Text
              numberOfLines={largeText ? 1 : undefined}
              maxFontSizeMultiplier={largeText ? 2 : undefined}
              style={[
                styles.modeText,
                {
                  color: selected
                    ? colors.textPrimary
                    : colors.textSecondary,
                },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <View style={styles.inputStep}>
      {largeText && modeSelector}
      <ScrollView
        ref={scrollRef}
        innerViewRef={scrollContentRef}
        onLayout={revealFocusedInput}
        onScroll={({ nativeEvent }) => { scrollOffset.current = nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.inputStepScroll}
        contentContainerStyle={styles.inputStepScrollContent}
      >
        {!largeText && modeSelector}
        <Reanimated.View key={inputMode} entering={modePanelEntry}>
        {inputMode === "text" && (
          <View style={styles.textModeContent}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>일정 내용</Text>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.sectionDescription, { color: colors.textSecondary }]}>{largeText ? "문장을 붙여넣거나 적어 주세요." : "날짜, 시간, 장소를 자유롭게 적어 주세요."}</Text>
            </View>
            <View style={[styles.inputWrap, largeText && styles.inputWrapLarge, { backgroundColor: inputBackground, borderColor: text.length > 0 ? colors.inputBorderFocused : colors.inputBorder }]}>
              <TextInput
                ref={inputRef}
                testID="quick-schedule-input-text"
                lineBreakStrategyIOS="hangul-word"
                accessibilityLabel="빠른 일정 문장"
                editable={!submitting}
                multiline
                maxLength={QUICK_TEXT_LIMIT}
                value={text}
                onChangeText={setText}
                onSubmitEditing={onSubmit}
                placeholder={placeholderForMode(inputMode)}
                placeholderTextColor={colors.inputPlaceholder}
                returnKeyType="done"
                selectionColor={BLUE}
                style={[styles.input, largeText && styles.inputLarge, { color: colors.textPrimary }]}
              />
              {(!largeText || text.length >= QUICK_TEXT_LIMIT * 0.8) && (
                <View style={[styles.counterPill, largeText && styles.counterPillLarge]}>
                  <Text style={[styles.counter, { color: colors.textSecondary }]}>{text.length}/{QUICK_TEXT_LIMIT}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {inputMode === "photo" && (
          <View style={styles.photoModeContent}>
            {selectedPhoto?.uri ? (
              <>
                <View testID="quick-schedule-photo-preview" style={[
                  styles.photoPreviewButton,
                  photoRecognitionError && styles.photoPreviewRecovery,
                  { borderColor: colors.border },
                ]}>
                  <View style={styles.photoImageStage}>
                    <QuickSchedulePhotoScanEffect
                      active={isPhotoRecognizing}
                      accessibilityLabel={isPhotoRecognizing ? "사진에서 일정 내용 읽는 중" : undefined}
                      borderRadius={14}
                      style={[styles.photoScanFrame, photoScanFrameStyle, photoRecognitionError && styles.photoScanFrameRecovery]}
                    >
                      <Image source={{ uri: selectedPhoto.uri }} resizeMode="contain" style={styles.photoImage} />
                    </QuickSchedulePhotoScanEffect>
                  </View>
                </View>
                <View style={styles.photoActionsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="선택한 사진 변경"
                    disabled={submitting || isVoiceFinalizing}
                    onPress={onPhotoActionSheet}
                    style={styles.photoChangeButton}
                  >
                    <Ionicons accessible={false} name="images-outline" size={18} color={colors.textPrimary} />
                    <Text style={[styles.photoChangeButtonText, { color: colors.textPrimary }]}>사진 바꾸기</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="선택한 사진 제거"
                    disabled={submitting}
                    onPress={onRemovePhoto}
                    style={styles.photoRemoveButton}
                  >
                    <Ionicons accessible={false} name="trash-outline" size={19} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="사진 선택"
                accessibilityHint="사진 촬영 또는 사진 앱 선택 메뉴가 열립니다"
                accessibilityState={{ disabled: submitting || isVoiceFinalizing }}
                disabled={submitting || isVoiceFinalizing}
                onPress={onPhotoActionSheet}
                style={({ pressed }) => [styles.photoEmptyPanel, { backgroundColor: mediaPanelBackground, borderColor: colors.border, opacity: pressed ? 0.82 : 1 }]}
              >
                <View style={[styles.photoEmptyIcon, { backgroundColor: mode === "dark" ? "rgba(36,107,254,0.16)" : "rgba(36,107,254,0.09)" }]}>
                  <Ionicons accessible={false} name="image-outline" size={23} color={BLUE} />
                </View>
                <Text lineBreakStrategyIOS="hangul-word" style={[styles.photoEmptyTitle, { color: colors.textPrimary }]}>{largeText ? "일정 사진 추가" : "일정이 담긴 사진을 추가하세요"}</Text>
                <Text lineBreakStrategyIOS="hangul-word" style={[styles.photoEmptyMeta, { color: colors.textSecondary }]}>{largeText ? "사진을 찍거나 보관함에서 골라 주세요." : "촬영하거나 사진 앱에서 선택하면 바로 읽습니다."}</Text>
              </Pressable>
            )}

            {selectedPhoto && (
              <View style={[styles.photoTranscriptWrap, { backgroundColor: mode === "dark" ? "#151821" : "#F8FAFD", borderColor: colors.inputBorder }]}>
                {isPhotoRecognizing && !photoRecognitionError && (
                  <View style={styles.photoTranscriptHeader} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="small" color={BLUE} />
                    <Text style={[styles.photoTranscriptLabel, { color: colors.textPrimary }]}>사진을 읽고 있어요</Text>
                  </View>
                )}

                {isPhotoRecognizing && !photoRecognitionError ? (
                  <View pointerEvents="none" testID="quick-schedule-photo-reading-placeholder" style={styles.photoReadingPlaceholder}>
                    <View style={[styles.photoReadingLine, styles.photoReadingLineLong]} />
                    <View style={[styles.photoReadingLine, styles.photoReadingLineMedium]} />
                    <View style={[styles.photoReadingLine, styles.photoReadingLineShort]} />
                  </View>
                ) : (
                  <>
                    {photoRecognitionError && (
                      <View style={[styles.photoRecognitionErrorWrap, { backgroundColor: photoErrorSurface, borderColor: photoErrorBorder }]}>
                        <Text accessibilityLiveRegion="polite" style={[styles.photoRecognitionErrorTitle, { color: photoErrorTitleColor }]}>
                          {isPhotoRecognizing ? "사진을 다시 읽고 있어요" : "일정 내용을 찾지 못했어요"}
                        </Text>
                        <Text style={[styles.photoRecognitionErrorText, { color: photoErrorTextColor }]}>날짜와 시간을 직접 적거나 사진을 바꿔 보세요.</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel="사진 내용 다시 읽기"
                          accessibilityState={{ busy: isPhotoRecognizing, disabled: isPhotoRecognizing || submitting }}
                          disabled={isPhotoRecognizing || submitting}
                          onPress={onPhotoRecognitionRetry} style={({ pressed }) => [styles.photoRecognitionRetry, { opacity: pressed || isPhotoRecognizing ? 0.72 : 1 }]}>
                          {isPhotoRecognizing ? <ActivityIndicator size="small" color={BLUE} /> :
                            <Ionicons accessible={false} name="refresh-outline" size={15} color={BLUE} />}
                          <Text style={styles.photoRecognitionRetryText}>다시 읽기</Text>
                        </Pressable>
                      </View>
                    )}
                    <Reanimated.View entering={photoTextEntrance} style={styles.photoTranscriptInputWrap}>
                      <Text style={[styles.photoTranscriptInputLabel, { color: colors.textSecondary }]}>{photoRecognitionError ? "직접 입력" : "일정 문장"}</Text>
                      <TextInput
                        testID="quick-schedule-photo-transcript"
                        accessibilityLabel="사진에서 읽은 내용"
                        editable={!submitting}
                        multiline
                        maxLength={QUICK_TEXT_LIMIT}
                        value={photoTranscript}
                        onChangeText={onPhotoTranscriptChange}
                        placeholder={photoRecognitionError ? "읽지 못한 내용을 직접 입력해 주세요." : "읽은 내용을 확인하고 수정할 수 있어요."}
                        placeholderTextColor={colors.inputPlaceholder}
                        selectionColor={BLUE}
                        style={[styles.photoTranscriptInput, largeText && styles.photoTranscriptInputLarge, { color: colors.textPrimary }]}
                      />
                    </Reanimated.View>
                    {(photoNeedsReview || photoTranscriptTruncated) && !photoRecognitionError && (
                      <View style={styles.lowConfidenceNotice}>
                        <Ionicons accessible={false} name="alert-circle-outline" size={14} color="#F59E0B" />
                        <Text style={styles.lowConfidenceNoticeText}>{photoTranscriptTruncated ? "사진 내용 일부만 표시했어요. 빠진 내용이 있으면 추가해 주세요." : "날짜·시간·장소를 확인해 주세요."}</Text>
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
          </View>
        )}

        {inputMode === "voice" && (
          <View style={[styles.voicePanel, { backgroundColor: mediaPanelBackground, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isVoiceRecording ? "실시간 음성 인식 중지" : voiceTranscript.trim() || voiceUri ? "음성 다시 인식" : "실시간 음성 인식 시작"}
              accessibilityState={{ disabled: submitting || isVoiceFinalizing }}
              onPress={isVoiceRecording ? onStopVoiceRecording : onStartVoiceRecording}
              disabled={submitting || isVoiceFinalizing}
              style={({ pressed }) => [styles.voiceRecordControl, { opacity: pressed ? 0.78 : isVoiceFinalizing ? 0.5 : 1 }]}
            >
              <View style={styles.voiceOrbWrap}>
                <VoiceSpectrumHalo energy={voiceSpectrumEnergy} />
                <View pointerEvents="none" testID="quick-schedule-voice-spectrum" style={styles.voiceSpectrum}>
                  {VOICE_SPECTRUM_BARS.map(barIndex => {
                    const angle = `${(360 / VOICE_SPECTRUM_BAR_COUNT) * barIndex}deg`;
                    const historyIndex = barIndex < VOICE_SPECTRUM_SAMPLE_COUNT ? barIndex : VOICE_SPECTRUM_BAR_COUNT - 1 - barIndex;
                    const texture = 0.78 + ((Math.sin(barIndex * 1.73) + 1) / 2) * 0.22;
                    const level = isVoiceRecording ? (voiceMeterHistory[historyIndex] ?? 0) * texture : 0;
                    const colorIndex = Math.min(VOICE_SPECTRUM_COLORS.length - 1, Math.floor((historyIndex / VOICE_SPECTRUM_SAMPLE_COUNT) * VOICE_SPECTRUM_COLORS.length));
                    return <VoiceSpectrumBar key={barIndex} angle={angle} color={VOICE_SPECTRUM_COLORS[colorIndex]} level={level} />;
                  })}
                </View>
                <View style={[styles.voiceOrb, { backgroundColor: isVoiceRecording ? BLUE : colors.surface, borderColor: isVoiceRecording || voiceTranscript.trim() || voiceUri ? BLUE : colors.border }]}>
                  <Ionicons accessible={false} name={isVoiceRecording ? "stop" : "mic-outline"} size={30} color={isVoiceRecording ? "#FFFFFF" : BLUE} />
                </View>
              </View>
              <Text style={[styles.voiceTitle, { color: colors.textPrimary }]}>{voiceControlTitle}</Text>
              <Text numberOfLines={2} style={[styles.voiceMeta, { color: colors.textSecondary }]}>{voiceControlMeta}</Text>
            </Pressable>
            <View style={[styles.voiceTranscriptWrap, { backgroundColor: inputBackground, borderColor: colors.inputBorder }]}>
              <View style={styles.voiceTranscriptHeader}>
                <Text style={[styles.voiceTranscriptLabel, { color: colors.textSecondary }]}>말한 내용</Text>
                {voiceTranscriptTruncated && <Text style={[styles.voiceConfidence, styles.truncatedRecognitionText]}>앞 300자만 표시</Text>}
              </View>
              <TextInput
                accessibilityLabel="실시간 음성 인식 텍스트"
                editable={!submitting && !isVoiceRecording && !isVoiceFinalizing}
                multiline
                maxLength={QUICK_TEXT_LIMIT}
                value={voiceTranscript}
                onChangeText={onVoiceTranscriptChange}
                placeholder={isVoiceRecording ? "말한 내용이 여기에 표시됩니다." : voiceUri ? "필요하면 내용을 직접 적어 주세요." : largeText ? "직접 적어도 돼요." : "직접 입력해도 됩니다."}
                placeholderTextColor={colors.inputPlaceholder}
                selectionColor={BLUE}
                style={[styles.voiceTranscriptInput, largeText && styles.voiceTranscriptInputLarge, { color: colors.textPrimary }]}
              />
            </View>
          </View>
        )}
        </Reanimated.View>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="입력 내용으로 일정 미리보기"
        accessibilityState={{ disabled: !canSubmit, busy: submitting }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => [styles.submitButton, largeText && styles.submitButtonLarge, { opacity: !canSubmit ? 0.45 : pressed ? 0.78 : 1 }]}
      >
        {submitting && showSubmitProgress ? (
          <BrandedLoader size="button" variant="schedule" accessibilityLabel="일정을 만들고 있어요" />
        ) : (
          <>
            <Ionicons accessible={false} name="calendar-outline" size={17} color="#fff" />
            <Text maxFontSizeMultiplier={largeText ? 2.35 : undefined} style={styles.submitText}>일정 미리보기</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = createQuickScheduleModalStyles({
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
});

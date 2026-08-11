import { Ionicons } from "@expo/vector-icons";
import React, { type RefObject } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import Reanimated from "react-native-reanimated";

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
  photoRecognitionState: string;
  photoScanFrameStyle: StyleProp<ViewStyle>;
  photoStatusAccessibilityLabel: string;
  photoStatusBackground: string;
  photoStatusColor: string;
  photoStatusIcon: keyof typeof Ionicons.glyphMap;
  photoStatusText: string;
  photoTranscript: string;
  photoTranscriptTruncated: boolean;
  segmentedBackground: string;
  selectedModeBackground: string;
  selectedPhoto: ImagePickerAsset | null;
  submitting: boolean;
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
  photoRecognitionState,
  photoScanFrameStyle,
  photoStatusAccessibilityLabel,
  photoStatusBackground,
  photoStatusColor,
  photoStatusIcon,
  photoStatusText,
  photoTranscript,
  photoTranscriptTruncated,
  segmentedBackground,
  selectedModeBackground,
  selectedPhoto,
  submitting,
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
  return (
    <View style={styles.inputStep}>
      <ScrollView
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.inputStepScroll}
        contentContainerStyle={styles.inputStepScrollContent}
      >
        <View
          style={[
            styles.modeSelector,
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

        {inputMode === "text" && (
          <View style={styles.textModeContent}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>일정 내용</Text>
              <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>날짜, 시간, 장소를 자유롭게 적어 주세요.</Text>
            </View>
            <View style={[styles.inputWrap, { backgroundColor: inputBackground, borderColor: text.length > 0 ? colors.inputBorderFocused : colors.inputBorder }]}>
              <TextInput
                ref={inputRef}
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
                style={[styles.input, { color: colors.textPrimary }]}
              />
              <View style={styles.counterPill}>
                <Text style={[styles.counter, { color: colors.textSecondary }]}>{text.length}/{QUICK_TEXT_LIMIT}</Text>
              </View>
            </View>
          </View>
        )}

        {inputMode === "photo" && (
          <View style={styles.photoModeContent}>
            {selectedPhoto?.uri ? (
              <View
                testID="quick-schedule-photo-preview"
                style={[styles.photoPreviewButton, { backgroundColor: mode === "dark" ? "#060A12" : "#0A1220", borderColor: isPhotoRecognizing ? "rgba(94,215,247,0.58)" : colors.border }]}
              >
                <Image accessible={false} source={{ uri: selectedPhoto.uri }} resizeMode="cover" style={styles.photoImageBackdrop} />
                <View pointerEvents="none" style={styles.photoImageBackdropScrim} />
                <View style={styles.photoImageStage}>
                  <QuickSchedulePhotoScanEffect
                    active={isPhotoRecognizing}
                    accessibilityLabel={isPhotoRecognizing ? "사진에서 일정 내용 읽는 중" : undefined}
                    borderRadius={14}
                    style={[styles.photoScanFrame, photoScanFrameStyle]}
                  >
                    <Image source={{ uri: selectedPhoto.uri }} resizeMode="contain" style={styles.photoImage} />
                  </QuickSchedulePhotoScanEffect>
                </View>
                <View
                  pointerEvents="none"
                  testID="quick-schedule-photo-status"
                  accessible={!isPhotoRecognizing}
                  accessibilityLabel={!isPhotoRecognizing ? photoStatusAccessibilityLabel : undefined}
                  accessibilityLiveRegion={photoRecognitionState === "ready" || photoRecognitionState === "error" ? "polite" : undefined}
                  style={[styles.photoStatusPill, { backgroundColor: photoStatusBackground }]}
                >
                  {isPhotoRecognizing ? <ActivityIndicator color={photoStatusColor} size="small" /> : <Ionicons accessible={false} name={photoStatusIcon} size={15} color={photoStatusColor} />}
                  <Text numberOfLines={1} style={[styles.photoStatusText, { color: photoStatusColor }]}>{photoStatusText}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="선택한 사진 변경"
                  accessibilityState={{ disabled: submitting || isVoiceFinalizing }}
                  disabled={submitting || isVoiceFinalizing}
                  onPress={onPhotoActionSheet}
                  hitSlop={4}
                  style={({ pressed }) => [styles.photoChangeButton, { opacity: pressed ? 0.72 : 1 }]}
                >
                  <Ionicons accessible={false} name="images-outline" size={15} color="#FFFFFF" />
                  <Text style={styles.photoChangeButtonText}>사진 바꾸기</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="선택한 사진 제거"
                  onPress={onRemovePhoto}
                  hitSlop={10}
                  style={({ pressed }) => [styles.photoRemoveButton, { opacity: pressed ? 0.72 : 1 }]}
                >
                  <Ionicons accessible={false} name="trash-outline" size={17} color="#FFFFFF" />
                </Pressable>
              </View>
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
                <Text style={[styles.photoEmptyTitle, { color: colors.textPrimary }]}>일정이 담긴 사진을 추가하세요</Text>
                <Text style={[styles.photoEmptyMeta, { color: colors.textSecondary }]}>촬영하거나 사진 앱에서 선택하면 바로 읽습니다.</Text>
              </Pressable>
            )}

            {selectedPhoto && (
              <View style={[styles.photoTranscriptWrap, { backgroundColor: mode === "dark" ? "#151821" : "#F8FAFD", borderColor: colors.inputBorder }]}>
                <View style={styles.photoTranscriptHeader}>
                  <View style={[styles.photoResultIcon, { backgroundColor: isPhotoRecognizing ? "rgba(36,107,254,0.12)" : photoRecognitionError ? "rgba(239,68,68,0.10)" : "rgba(16,185,129,0.10)" }]}>
                    <Ionicons accessible={false} name={isPhotoRecognizing ? "scan-outline" : photoRecognitionError ? "alert-circle-outline" : "document-text-outline"} size={18} color={isPhotoRecognizing ? BLUE : photoRecognitionError ? "#D94A4A" : "#0D9F6E"} />
                  </View>
                  <View style={styles.photoResultTitleWrap}>
                    <Text style={[styles.photoTranscriptLabel, { color: colors.textPrimary }]}>{isPhotoRecognizing ? "사진을 읽고 있어요" : "읽어온 내용"}</Text>
                    {isPhotoRecognizing && <Text style={[styles.photoResultMeta, { color: colors.textSecondary }]}>날짜·시간·장소를 찾고 있어요</Text>}
                  </View>
                  {photoTranscriptTruncated ? (
                    <View style={styles.truncatedRecognitionBadge}><Text style={[styles.photoConfidence, styles.truncatedRecognitionText]}>일부만 표시</Text></View>
                  ) : photoNeedsReview ? (
                    <View style={styles.photoReviewBadge}><Text style={styles.photoReviewBadgeText}>확인 필요</Text></View>
                  ) : null}
                </View>

                {isPhotoRecognizing ? (
                  <View pointerEvents="none" testID="quick-schedule-photo-reading-placeholder" style={styles.photoReadingPlaceholder}>
                    <View style={[styles.photoReadingLine, styles.photoReadingLineLong]} />
                    <View style={[styles.photoReadingLine, styles.photoReadingLineMedium]} />
                    <View style={[styles.photoReadingLine, styles.photoReadingLineShort]} />
                  </View>
                ) : (
                  <>
                    {photoRecognitionError && (
                      <View style={[styles.photoRecognitionErrorWrap, { backgroundColor: photoErrorSurface, borderColor: photoErrorBorder }]}>
                        <Text style={[styles.photoRecognitionErrorTitle, { color: photoErrorTitleColor }]}>일정 내용을 찾지 못했어요</Text>
                        <Text style={[styles.photoRecognitionErrorText, { color: photoErrorTextColor }]}>날짜나 시간이 선명한 사진으로 바꾸거나 직접 입력해 주세요.</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel="사진 내용 다시 읽기" onPress={onPhotoRecognitionRetry} style={({ pressed }) => [styles.photoRecognitionRetry, { opacity: pressed ? 0.72 : 1 }]}>
                          <Ionicons accessible={false} name="refresh" size={15} color={BLUE} />
                          <Text style={styles.photoRecognitionRetryText}>다시 읽기</Text>
                        </Pressable>
                      </View>
                    )}
                    <View style={styles.photoTranscriptInputWrap}>
                      <Text style={[styles.photoTranscriptInputLabel, { color: colors.textSecondary }]}>{photoRecognitionError ? "직접 입력" : "일정 문장"}</Text>
                      <TextInput
                        accessibilityLabel="사진에서 읽은 내용"
                        editable={!submitting}
                        multiline
                        maxLength={QUICK_TEXT_LIMIT}
                        value={photoTranscript}
                        onChangeText={onPhotoTranscriptChange}
                        placeholder={photoRecognitionError ? "읽지 못한 내용을 직접 입력해 주세요." : "읽은 내용을 확인하고 수정할 수 있어요."}
                        placeholderTextColor={colors.inputPlaceholder}
                        selectionColor={BLUE}
                        style={[styles.photoTranscriptInput, { color: colors.textPrimary }]}
                      />
                    </View>
                    {photoNeedsReview && (
                      <View style={styles.lowConfidenceNotice}>
                        <Ionicons accessible={false} name="alert-circle-outline" size={14} color="#F59E0B" />
                        <Text style={styles.lowConfidenceNoticeText}>일부 내용을 정확히 읽지 못했어요. 날짜·시간·장소를 확인해 주세요.</Text>
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
                placeholder={isVoiceRecording ? "말한 내용이 여기에 표시됩니다." : voiceUri ? "필요하면 내용을 직접 적어 주세요." : "직접 입력해도 됩니다."}
                placeholderTextColor={colors.inputPlaceholder}
                selectionColor={BLUE}
                style={[styles.voiceTranscriptInput, { color: colors.textPrimary }]}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="입력 내용으로 일정 미리보기"
        accessibilityState={{ disabled: !canSubmit, busy: submitting }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => [styles.submitButton, { opacity: !canSubmit ? 0.45 : pressed ? 0.78 : 1 }]}
      >
        {submitting ? (
          <BrandedLoader size="button" variant="schedule" accessibilityLabel="일정을 만들고 있어요" />
        ) : (
          <>
            <Ionicons accessible={false} name="calendar-outline" size={17} color="#fff" />
            <Text style={styles.submitText}>일정 미리보기</Text>
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

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    BackHandler,
    LayoutChangeEvent,
    Platform,
    TextInput,
    useWindowDimensions,
} from "react-native";
import {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import { ADD_MENU_SOURCE } from "../../addHandoffMotion";
import type { QuickScheduleMediaInput } from "../../quickInputExtraction";
import type {
    QuickScheduleReliabilityFeedback,
    ScheduleCategory,
    ScheduleItem,
    ScheduleParseResult,
} from "../../types";
import {
    isQuickScheduleRouteReady as canUseRouteNotification,
    type QuickSchedulePreviewField as PreviewField,
} from "../../quickScheduleDraft";
import { QuickScheduleInputStep } from "./QuickScheduleInputStep";
import { QuickScheduleEditStep } from "./QuickScheduleEditStep";
import { QuickSchedulePreviewStep } from "./QuickSchedulePreviewStep";
import { QuickScheduleModalShell } from "./QuickScheduleModalShell";
import {
    QuickScheduleErrorStep,
    QuickScheduleLoadingStep,
    QuickScheduleSavedStep,
} from "./QuickScheduleStatusSteps";
import { useQuickSchedulePhotoRecognition } from "./useQuickSchedulePhotoRecognition";
import { useQuickSchedulePhotoActions } from "./useQuickSchedulePhotoActions";
import { useQuickScheduleVoiceController } from "./useQuickScheduleVoiceController";
import { useQuickScheduleDraftController } from "./useQuickScheduleDraftController";
import { useQuickScheduleMorphStyles } from "./useQuickScheduleMorphStyles";
import { useQuickScheduleMorphLifecycle } from "./useQuickScheduleMorphLifecycle";
import { useQuickScheduleCategorySelection } from "./useQuickScheduleCategorySelection";
import {
    buildQuickSchedulePresentation,
    getQuickSchedulePreviewValue,
} from "./quickSchedulePresentation";
import {
    CARD_HEIGHT_BY_MODE,
    CARD_SIZE_SPRING,
    CLOSE_TARGET_HEIGHT,
    CLOSE_TARGET_WIDTH,
    EDIT_CARD_HEIGHT_BY_FIELD,
    FLOW_CARD_HEIGHT_BY_STEP,
    MODE_PILL_SPRING,
    PREWARM_PRESENTATION_OPACITY,
    formatKoreanDate,
    type InputMode,
    type TabLayout,
} from "./quickScheduleModalModel";

export { resolvePhotoPreviewAspectRatio } from "./quickScheduleModalModel";

type Props = {
    visible: boolean;
    prewarm?: boolean;
    initialText?: string;
    initialRequestId?: string;
    initialInputType?: QuickScheduleMediaInput["inputTypeOverride"];
    /** Development preview entry point used to render each field flow in Simulator QA. */
    initialPreviewField?: PreviewField;
    onClose: () => void;
    onCloseStart?: () => void;
    onAnalyze: (text: string, media?: QuickScheduleMediaInput) => Promise<ScheduleParseResult>;
    onSave: (payload: Omit<ScheduleItem, "id">) => void | Promise<void>;
    onFeedback?: (feedback: QuickScheduleReliabilityFeedback) => void | Promise<void>;
    defaultDay: string;
    defaultCategory?: ScheduleCategory;
    categories?: ScheduleCategory[];
    categoryError?: string | null;
    categoryLoading?: boolean;
    onRetryCategories?: () => void;
    sourceTopOffset?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    sourceRightOffset?: number;
    closeTargetWidth?: number;
    onMorphReady?: () => void;
    morphPresenterRef?: React.MutableRefObject<QuickScheduleMorphPresenter | null>;
};

export type QuickScheduleMorphPresenter = () => boolean;

export default function QuickScheduleModal({
    visible,
    prewarm = false,
    initialText,
    initialRequestId,
    initialInputType,
    initialPreviewField,
    onClose,
    onCloseStart,
    onAnalyze,
    onSave,
    onFeedback,
    defaultDay,
    defaultCategory,
    categories,
    categoryError,
    categoryLoading = false,
    onRetryCategories,
    sourceTopOffset = 4,
    sourceWidth = ADD_MENU_SOURCE.fallbackWidth,
    sourceHeight = ADD_MENU_SOURCE.nativeHeight,
    sourceRightOffset = ADD_MENU_SOURCE.fallbackRightInset,
    closeTargetWidth = CLOSE_TARGET_WIDTH,
    onMorphReady,
    morphPresenterRef,
}: Props) {
    const { colors, mode } = useTheme();
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const {
        previewCategoryChevronRotation,
        previewCategoryPickerMarginBottom,
        previewCategoryPickerOpen,
        previewCategoryPickerPaddingTop,
        selectedCategory,
        selectedCategoryId,
        setPreviewCategoryPickerOpen,
        setSelectedCategoryId,
        writableCategories,
    } = useQuickScheduleCategorySelection({ categories, defaultCategory, visible });
    const [rendered, setRendered] = useState(visible || prewarm);
    const [text, setText] = useState("");
    const [inputMode, setInputMode] = useState<InputMode>("text");
    const {
        clearPhotoRecognition,
        isPhotoRecognizing,
        photoRecognitionConfidence,
        photoRecognitionError,
        photoTranscript,
        photoTranscriptTruncated,
        resetPhotoRecognition,
        selectPhotoForRecognition,
        selectedPhoto,
        setPhotoRecognitionAttempt,
        setPhotoRecognitionConfidence,
        setPhotoRecognitionError,
        setPhotoTranscript,
        setPhotoTranscriptTruncated,
    } = useQuickSchedulePhotoRecognition();
    const [submitting, setSubmitting] = useState(false);
    const [cardRasterized, setCardRasterized] = useState(false);
    const [contentMounted, setContentMounted] = useState(visible || prewarm);
    const [modeLayouts, setModeLayouts] = useState<Partial<Record<InputMode, TabLayout>>>({});
    const progress = useSharedValue(0);
    const closingPhase = useSharedValue(0);
    const presentationOpacity = useSharedValue(visible && !prewarm ? 1 : PREWARM_PRESENTATION_OPACITY);
    const presentationStyle = useAnimatedStyle(() => ({
        opacity: presentationOpacity.value,
    }));
    const modeIndicatorX = useSharedValue(0);
    const modeIndicatorWidth = useSharedValue(0);
    const inputRef = useRef<TextInput>(null);
    const closingRef = useRef(false);
    const visibleRef = useRef(visible);
    const mountedRef = useRef(false);
    const {
        hasActiveVoiceSession,
        invalidateVoiceOperations,
        isVoiceFinalizing,
        isVoiceRecording,
        resetVoiceInput,
        startVoiceRecording,
        stopActiveRecording,
        stopVoiceRecording,
        updateVoiceTranscript,
        voiceDurationMillis,
        voiceMeterHistory,
        voiceRecognitionAlternatives,
        voiceRecognitionConfidence,
        voiceStatusMessage,
        voiceTranscript,
        voiceTranscriptTruncated,
        voiceUri,
    } = useQuickScheduleVoiceController({
        clearPhotoRecognition,
        closingRef,
        defaultCategoryTitle: defaultCategory?.title,
        mountedRef,
        selectedCategoryTitle: selectedCategory?.title,
        setInputMode,
        submitting,
        text,
        visibleRef,
    });
    const recorderState = {
        isRecording: isVoiceRecording,
        durationMillis: voiceDurationMillis,
    };
    const {
        analysisError,
        cancelEditField,
        confirmEditField,
        editingAlertMode,
        editingField,
        editingValue,
        flowStep,
        invalidatePendingAnalysis,
        openEditField,
        openRoutePlannerFromPreview,
        previewDraft,
        previewSourceText,
        resetDraftFlow,
        routePlannerHidden,
        savePreview,
        setEditingAlertMode,
        setEditingValue,
        setFlowStep,
        setPreviewDraft,
        setTimeEditMode,
        submit,
        timeEditMode,
    } = useQuickScheduleDraftController({
        categoryError,
        clearPhotoRecognition,
        closingRef,
        defaultDay,
        initialInputType,
        initialPreviewField,
        initialRequestId,
        initialText,
        inputMode,
        isPhotoRecognizing,
        isVoiceRecording,
        onAnalyze,
        onFeedback,
        onSave,
        photoRecognitionConfidence,
        photoTranscript,
        progress,
        resetVoiceInput,
        selectedCategory,
        selectedPhoto,
        setContentMounted,
        setInputMode,
        setRendered,
        setSubmitting,
        setText,
        submitting,
        text,
        visible,
        visibleRef,
        voiceDurationMillis,
        voiceRecognitionAlternatives,
        voiceRecognitionConfidence,
        voiceTranscript,
        voiceUri,
    });

    useEffect(() => {
        if (flowStep !== "preview") setPreviewCategoryPickerOpen(false);
    }, [flowStep, setPreviewCategoryPickerOpen]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const cardWidth = Math.min(width - 60, 348);
    const sourceRight = width - sourceRightOffset;
    const openSourceWidth = sourceWidth;
    const openSourceHeight = sourceHeight;
    const openSourceLeft = sourceRight - openSourceWidth;
    const closeSourceWidth = closeTargetWidth;
    const closeSourceHeight = CLOSE_TARGET_HEIGHT;
    const closeSourceLeft = sourceRight - closeSourceWidth;
    const sourceTop = insets.top + sourceTopOffset;
    const cardTop = sourceTop;
    const baseCardHeight =
        flowStep === "input"
            ? inputMode === "photo" && !selectedPhoto
                ? 378
                : CARD_HEIGHT_BY_MODE[inputMode]
            : flowStep === "edit" && editingField
            ? EDIT_CARD_HEIGHT_BY_FIELD[editingField]
            : FLOW_CARD_HEIGHT_BY_STEP[flowStep];
    const targetCardHeight = baseCardHeight + (categoryError && onRetryCategories ? 58 : 0);
    const cardHeight = Math.min(targetCardHeight, height - cardTop - Math.max(insets.bottom, 16) - 12);
    const expandedCardHeight = useSharedValue(cardHeight);
    const cardLeft = (width - cardWidth) / 2;
    const openSourceRadius = Math.min(openSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);
    const closeSourceRadius = Math.min(closeSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);

    const notificationRouteReady = canUseRouteNotification(previewDraft);

    const handleModeLayout = useCallback(
        (key: InputMode) => (event: LayoutChangeEvent) => {
            const { x, width: measuredWidth } = event.nativeEvent.layout;

            setModeLayouts(current => {
                const previous = current[key];
                if (previous && Math.abs(previous.x - x) < 0.5 && Math.abs(previous.width - measuredWidth) < 0.5) {
                    return current;
                }

                return {
                    ...current,
                    [key]: {
                        x,
                        width: measuredWidth,
                    },
                };
            });
        },
        [],
    );

    const {
        activatePhotoMode,
        invalidatePhotoSource,
        openPhotoActionSheet,
    } = useQuickSchedulePhotoActions({
        closingRef,
        mode,
        mountedRef,
        selectPhotoForRecognition,
        setInputMode,
        stopActiveRecording,
        submitting,
        visibleRef,
    });

    const {
        handleSeedLayout,
        isPrewarmOnly,
        requestClose,
    } = useQuickScheduleMorphLifecycle({
        closingPhase,
        closingRef,
        contentMounted,
        flowStep,
        hasActiveVoiceSession,
        invalidatePendingAnalysis,
        invalidatePhotoSource,
        invalidateVoiceOperations,
        isVoiceFinalizing,
        isVoiceRecording,
        morphPresenterRef,
        onClose,
        onCloseStart,
        onFeedback,
        onMorphReady,
        photoTranscript,
        presentationOpacity,
        prewarm,
        previewDraft,
        progress,
        rendered,
        resetDraftFlow,
        resetPhotoRecognition,
        resetVoiceInput,
        routePlannerHidden,
        selectedPhotoUri: selectedPhoto?.uri,
        setCardRasterized,
        setContentMounted,
        setInputMode,
        setPreviewCategoryPickerOpen,
        setRendered,
        setSelectedCategoryId,
        setSubmitting,
        setText,
        stopActiveRecording,
        submitting,
        text,
        visible,
        visibleRef,
        voiceDurationMillis,
        voiceTranscript,
        voiceUri,
    });

    const handleModePress = useCallback(
        (nextMode: InputMode) => {
            if (nextMode === "photo") {
                activatePhotoMode();
                return;
            }

            invalidatePhotoSource();
            if (nextMode === "voice") {
                if (inputMode !== "voice") {
                    void stopActiveRecording();
                }
                setInputMode("voice");
                return;
            }

            void stopActiveRecording();
            setInputMode(nextMode);
        },
        [activatePhotoMode, inputMode, invalidatePhotoSource, stopActiveRecording],
    );

    useEffect(() => {
        if (Platform.OS !== "android" || routePlannerHidden || (!visible && !rendered)) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            if (flowStep === "edit") {
                cancelEditField();
                return true;
            }
            if (flowStep === "preview" || flowStep === "analysisError") {
                setFlowStep("input");
                return true;
            }
            if (flowStep === "analyzing") {
                invalidatePendingAnalysis();
                setSubmitting(false);
                setFlowStep("input");
                return true;
            }
            if (flowStep === "saving") return true;
            requestClose();
            return true;
        });
        return () => subscription.remove();
    }, [
        cancelEditField,
        flowStep,
        invalidatePendingAnalysis,
        rendered,
        requestClose,
        routePlannerHidden,
        setFlowStep,
        visible,
    ]);

    useEffect(() => {
        const selectedLayout = modeLayouts[inputMode];
        if (!selectedLayout) return;

        modeIndicatorX.value = withSpring(selectedLayout.x, MODE_PILL_SPRING);
        modeIndicatorWidth.value = withSpring(selectedLayout.width, MODE_PILL_SPRING);
    }, [inputMode, modeIndicatorWidth, modeIndicatorX, modeLayouts]);

    useEffect(() => {
        expandedCardHeight.value = withSpring(cardHeight, CARD_SIZE_SPRING);
    }, [cardHeight, expandedCardHeight]);

    const {
        backdropAnimatedStyle,
        cardClipRadiusStyle,
        cardDenseCloseStyle,
        cardMotionRadiusStyle,
        cardMotionStyle,
        contentRevealCurtainAnimatedStyle,
        modeIndicatorAnimatedStyle,
    } = useQuickScheduleMorphStyles({
        cardLeft,
        cardTop,
        cardWidth,
        closeSourceHeight,
        closeSourceLeft,
        closeSourceRadius,
        closeSourceWidth,
        closingPhase,
        expandedCardHeight,
        modeIndicatorWidth,
        modeIndicatorX,
        openSourceHeight,
        openSourceLeft,
        openSourceRadius,
        openSourceWidth,
        progress,
        sourceTop,
    });
    const cardBorderColor = colors.border;
    // Keep the scaled layer lightweight. A live native blur is re-rasterized
    // while the card grows and was producing visible 26-35ms frame gaps.
    const cardSurfaceBackground = mode === "dark" ? "#1C1C1E" : "#FFFFFF";
    const segmentedBackground = colors.surface2;
    const selectedModeBackground = colors.surface;
    const inputBackground = colors.inputBackground;
    const mediaPanelBackground = colors.surface2;
    const {
        canSubmit,
        flowTitle,
        inputModeDescription,
        photoErrorBorder,
        photoErrorSurface,
        photoErrorTextColor,
        photoErrorTitleColor,
        photoNeedsReview,
        photoRecognitionState,
        photoScanFrameStyle,
        photoStatusAccessibilityLabel,
        photoStatusBackground,
        photoStatusColor,
        photoStatusIcon,
        photoStatusText,
        previewChevronColor,
        previewDividerColor,
        previewIconBackground,
        previewLabelColor,
        successColor,
        voiceControlMeta,
        voiceControlTitle,
        voiceSpectrumEnergy,
        warningBackground,
        warningTextColor,
    } = buildQuickSchedulePresentation({
        cardWidth,
        editingField,
        flowStep,
        inputMode,
        isDark: mode === "dark",
        isPhotoRecognizing,
        isVoiceFinalizing,
        isVoiceRecording,
        photoRecognitionConfidence,
        photoRecognitionError,
        photoTranscript,
        selectedPhoto,
        submitting,
        text,
        voiceDurationMillis,
        voiceMeterHistory,
        voiceStatusMessage,
        voiceTranscript,
        voiceUri,
    });
    const getPreviewValue = getQuickSchedulePreviewValue;

    /** 사용자가 수정한 사진 인식 문장을 반영하고 자동 인식 오류·신뢰도 표시는 초기화한다. */
    const handlePhotoTranscriptChange = useCallback((value: string) => {
        setPhotoTranscript(value);
        setPhotoTranscriptTruncated(false);
        setPhotoRecognitionConfidence(undefined);
        setPhotoRecognitionError("");
    }, [
        setPhotoRecognitionConfidence,
        setPhotoRecognitionError,
        setPhotoTranscript,
        setPhotoTranscriptTruncated,
    ]);

    /** 현재 입력 모드에 필요한 상태와 명령을 입력 단계 전용 화면에 전달한다. */
    const renderInputStep = () => (
        <QuickScheduleInputStep
            canSubmit={canSubmit}
            cardBorderColor={cardBorderColor}
            colors={colors}
            flowStep={flowStep}
            handleModeLayout={handleModeLayout}
            handleModePress={handleModePress}
            inputBackground={inputBackground}
            inputMode={inputMode}
            inputRef={inputRef}
            isPhotoRecognizing={isPhotoRecognizing}
            isVoiceFinalizing={isVoiceFinalizing}
            mediaPanelBackground={mediaPanelBackground}
            mode={mode}
            modeIndicatorAnimatedStyle={modeIndicatorAnimatedStyle}
            onPhotoActionSheet={() => void openPhotoActionSheet()}
            onPhotoRecognitionRetry={() => setPhotoRecognitionAttempt(current => current + 1)}
            onPhotoTranscriptChange={handlePhotoTranscriptChange}
            onRemovePhoto={() => selectPhotoForRecognition(null)}
            onStartVoiceRecording={() => void startVoiceRecording()}
            onStopVoiceRecording={() => void stopVoiceRecording()}
            onSubmit={submit}
            onVoiceTranscriptChange={updateVoiceTranscript}
            photoErrorBorder={photoErrorBorder}
            photoErrorSurface={photoErrorSurface}
            photoErrorTextColor={photoErrorTextColor}
            photoErrorTitleColor={photoErrorTitleColor}
            photoNeedsReview={photoNeedsReview}
            photoRecognitionError={photoRecognitionError}
            photoRecognitionState={photoRecognitionState}
            photoScanFrameStyle={photoScanFrameStyle}
            photoStatusAccessibilityLabel={photoStatusAccessibilityLabel}
            photoStatusBackground={photoStatusBackground}
            photoStatusColor={photoStatusColor}
            photoStatusIcon={photoStatusIcon}
            photoStatusText={photoStatusText}
            photoTranscript={photoTranscript}
            photoTranscriptTruncated={photoTranscriptTruncated}
            segmentedBackground={segmentedBackground}
            selectedModeBackground={selectedModeBackground}
            selectedPhoto={selectedPhoto}
            setText={setText}
            submitting={submitting}
            text={text}
            voiceControlMeta={voiceControlMeta}
            voiceControlTitle={voiceControlTitle}
            voiceDurationMillis={voiceDurationMillis}
            voiceMeterHistory={voiceMeterHistory}
            voiceSpectrumEnergy={voiceSpectrumEnergy}
            voiceTranscript={voiceTranscript}
            voiceTranscriptTruncated={voiceTranscriptTruncated}
            voiceUri={voiceUri}
            isVoiceRecording={recorderState.isRecording}
        />
    );

    /** 분석·저장 단계에 맞는 제목과 설명으로 공통 로딩 화면을 구성한다. */
    const renderLoadingStep = () => {
        const isSaving = flowStep === "saving";
        const headline = isSaving ? "일정을 저장하고 있어요" : "일정 초안을 만들고 있어요";
        const caption = isSaving
            ? "일정과 이동 정보를 정리하고 있어요"
            : inputMode === "photo"
            ? "사진 속 날짜와 장소를 확인하고 있어요"
            : inputMode === "voice"
            ? "말한 내용에서 일정 정보를 찾고 있어요"
            : "입력한 내용에서 일정 정보를 찾고 있어요";
        return <QuickScheduleLoadingStep caption={caption} colors={colors} headline={headline} />;
    };

    /** 분석 오류와 재시도 명령을 오류 단계 전용 화면에 전달한다. */
    const renderErrorStep = () => (
        <QuickScheduleErrorStep
            cardBorderColor={cardBorderColor}
            colors={colors}
            errorMessage={analysisError}
            inputBackground={inputBackground}
            onEdit={() => setFlowStep("input")}
            onRetry={submit}
            submitting={submitting}
            warningBackground={warningBackground}
            warningTextColor={warningTextColor}
        />
    );

    /** 분석된 초안과 카테고리·검토 명령을 미리보기 전용 화면에 전달한다. */
    const renderPreviewStep = () => {
        if (!previewDraft) return null;
        return (
            <QuickSchedulePreviewStep
                colors={colors}
                getPreviewValue={getPreviewValue}
                mode={mode}
                onOpenEditField={openEditField}
                onSave={() => void savePreview()}
                previewCategoryChevronRotation={previewCategoryChevronRotation}
                previewCategoryPickerMarginBottom={previewCategoryPickerMarginBottom}
                previewCategoryPickerOpen={previewCategoryPickerOpen}
                previewCategoryPickerPaddingTop={previewCategoryPickerPaddingTop}
                previewChevronColor={previewChevronColor}
                previewDividerColor={previewDividerColor}
                previewDraft={previewDraft}
                previewIconBackground={previewIconBackground}
                previewLabelColor={previewLabelColor}
                previewSourceText={previewSourceText}
                selectedCategory={selectedCategory}
                selectedCategoryId={selectedCategoryId}
                setFlowStep={setFlowStep}
                setPreviewCategoryPickerOpen={setPreviewCategoryPickerOpen}
                setPreviewDraft={setPreviewDraft}
                setSelectedCategoryId={setSelectedCategoryId}
                submitting={submitting}
                warningBackground={warningBackground}
                warningTextColor={warningTextColor}
                writableCategories={writableCategories}
            />
        );
    };

    /** 선택한 초안 필드와 편집 명령을 필드 편집 전용 화면에 전달한다. */
    const renderEditStep = () => {
        if (!editingField || !previewDraft) return null;
        return (
            <QuickScheduleEditStep
                colors={colors}
                editingAlertMode={editingAlertMode}
                editingField={editingField}
                editingValue={editingValue}
                inputBackground={inputBackground}
                mode={mode}
                notificationRouteReady={notificationRouteReady}
                onCancel={cancelEditField}
                onConfirm={confirmEditField}
                onOpenRoutePlanner={openRoutePlannerFromPreview}
                previewChevronColor={previewChevronColor}
                previewDividerColor={previewDividerColor}
                previewDraft={previewDraft}
                selectedModeBackground={selectedModeBackground}
                setEditingAlertMode={setEditingAlertMode}
                setEditingValue={setEditingValue}
                setTimeEditMode={setTimeEditMode}
                successColor={successColor}
                timeEditMode={timeEditMode}
                warningBackground={warningBackground}
                warningTextColor={warningTextColor}
            />
        );
    };

    /** 저장된 일정 날짜와 닫기 동작을 완료 화면에 전달한다. */
    const renderSavedStep = () => (
        <QuickScheduleSavedStep
            colors={colors}
            dateLabel={previewDraft ? formatKoreanDate(previewDraft.date) : undefined}
            onClose={requestClose}
            successColor={successColor}
        />
    );

    /** 현재 흐름 단계에 해당하는 전용 화면만 선택하여 렌더링한다. */
    const renderCurrentStep = () => {
        switch (flowStep) {
            case "analyzing":
            case "saving":
                return renderLoadingStep();
            case "analysisError":
                return renderErrorStep();
            case "preview":
                return renderPreviewStep();
            case "edit":
                return renderEditStep();
            case "saved":
                return renderSavedStep();
            case "input":
            default:
                return renderInputStep();
        }
    };

    // `finishClose` clears the local closing state before the parent's
    // `visible=false` prop is guaranteed to commit. Key visibility off the
    // local render lifecycle so the reset add-menu seed cannot flash for an
    // intermediate frame after the surface has finished closing.
    if (!rendered || routePlannerHidden) {
        return null;
    }

    return (
        <QuickScheduleModalShell
            backdropAnimatedStyle={backdropAnimatedStyle}
            cardBorderColor={cardBorderColor}
            cardClipRadiusStyle={cardClipRadiusStyle}
            cardDenseCloseStyle={cardDenseCloseStyle}
            cardMotionRadiusStyle={cardMotionRadiusStyle}
            cardMotionStyle={cardMotionStyle}
            cardRasterized={cardRasterized}
            cardSurfaceBackground={cardSurfaceBackground}
            categoryError={categoryError}
            categoryLoading={categoryLoading}
            colors={colors}
            contentMounted={contentMounted}
            contentRevealCurtainAnimatedStyle={contentRevealCurtainAnimatedStyle}
            currentStep={contentMounted ? renderCurrentStep() : null}
            flowStep={flowStep}
            flowTitle={flowTitle}
            inputModeDescription={inputModeDescription}
            isPrewarmOnly={isPrewarmOnly}
            mode={mode}
            onCancelEditField={cancelEditField}
            onRequestClose={requestClose}
            onRetryCategories={onRetryCategories}
            onSeedLayout={handleSeedLayout}
            presentationStyle={presentationStyle}
            submitting={submitting}
        />
    );
}

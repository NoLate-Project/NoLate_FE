import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    BackHandler,
    Keyboard,
    LayoutChangeEvent,
    Platform,
    TextInput,
    useWindowDimensions,
    type KeyboardEvent,
} from "react-native";
import Reanimated, {
    FadeIn,
    ReduceMotion,
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
    const { width, height, fontScale } = useWindowDimensions();
    const largeText = fontScale > 1.35;
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
    const [keyboardTop, setKeyboardTop] = useState<number>();
    useEffect(() => {
        if (Platform.OS !== "ios" || !visible) {
            setKeyboardTop(undefined);
            return;
        }
        setKeyboardTop(Keyboard.metrics()?.screenY);
        const update = ({ endCoordinates }: KeyboardEvent) => {
            setKeyboardTop(endCoordinates.height > 0 && endCoordinates.screenY > 0 ? endCoordinates.screenY : undefined);
        };
        const change = Keyboard.addListener("keyboardWillChangeFrame", update);
        const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardTop(undefined));
        return () => {
            change.remove();
            hide.remove();
        };
    }, [visible]);
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
        retryPhotoRecognition,
        editPhotoTranscript,
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
        routeDraftChange,
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

    const [showAnalysisWait, setShowAnalysisWait] = useState(false);
    const [inputReturning, setInputReturning] = useState(false);
    const previousInputStep = useRef<"input" | "analysisError">("input");
    const previousFlowStep = useRef(flowStep);
    const previewScrollY = useRef(0);
    const [previewSourceExpanded, setPreviewSourceExpanded] = useState(false);
    const returningFromField = flowStep === "preview" && previousFlowStep.current === "edit";
    const destinationChange = routeDraftChange?.kind === "destinationChanged" ? routeDraftChange : undefined;
    const displayedDestinationChange = useRef(destinationChange);
    const showNewDestinationNotice = destinationChange !== displayedDestinationChange.current && Boolean(destinationChange);
    useEffect(() => {
        previousFlowStep.current = flowStep;
        if (flowStep === "preview") displayedDestinationChange.current = destinationChange;
        if (!visible || flowStep === "input" || flowStep === "analyzing") {
            previewScrollY.current = 0;
            setPreviewSourceExpanded(false);
        }
    }, [destinationChange, flowStep, visible]);
    useEffect(() => {
        if (flowStep === "input" || flowStep === "analysisError") previousInputStep.current = flowStep;
        if (flowStep !== "input") setInputReturning(false);
        if (!visible || flowStep !== "analyzing") {
            setShowAnalysisWait(false);
            return;
        }
        const revealTimer = setTimeout(() => setShowAnalysisWait(true), 120);
        return () => clearTimeout(revealTimer);
    }, [flowStep, visible]);

    const presentedStep = flowStep === "analyzing" && !showAnalysisWait ? previousInputStep.current : flowStep;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const cardWidth = largeText ? Math.min(width - 32, 400) : Math.min(width - 60, 348);
    const sourceRight = width - sourceRightOffset;
    const openSourceWidth = sourceWidth;
    const openSourceHeight = sourceHeight;
    const openSourceLeft = sourceRight - openSourceWidth;
    const closeSourceWidth = closeTargetWidth;
    const closeSourceHeight = CLOSE_TARGET_HEIGHT;
    const closeSourceLeft = sourceRight - closeSourceWidth;
    const sourceTop = insets.top + sourceTopOffset;
    const cardTop = sourceTop;
    const notificationRouteReady = canUseRouteNotification(previewDraft);
    const baseCardHeight =
        presentedStep === "input"
            ? inputMode === "photo" && !selectedPhoto
                ? 378
                : CARD_HEIGHT_BY_MODE[inputMode]
            : presentedStep === "edit" && editingField
            ? editingField === "notification" && !notificationRouteReady
                ? 344
                : EDIT_CARD_HEIGHT_BY_FIELD[editingField]
            : FLOW_CARD_HEIGHT_BY_STEP[presentedStep];
    const targetCardHeight = baseCardHeight + (categoryError && onRetryCategories ? 58 : 0);
    const restingCardBottom = height - Math.max(insets.bottom, 16) - 12;
    const cardBottom = keyboardTop === undefined ? restingCardBottom : Math.min(restingCardBottom, keyboardTop - 8);
    const availableCardHeight = Math.max(1, cardBottom - cardTop);
    const keepLargeCard = largeText && (
        ["input", "analyzing", "analysisError", "preview", "saving", "saved"].includes(presentedStep)
        || (presentedStep === "edit" && editingField === "notification")
    );
    const cardHeight = keepLargeCard ? availableCardHeight : Math.min(targetCardHeight, availableCardHeight);
    const expandedCardHeight = useSharedValue(cardHeight);
    const cardLeft = (width - cardWidth) / 2;
    const openSourceRadius = Math.min(openSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);
    const closeSourceRadius = Math.min(closeSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);

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

            if (nextMode !== inputMode) Keyboard.dismiss();
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

    const cancelAnalysisToInput = useCallback(() => {
        invalidatePendingAnalysis();
        setSubmitting(false);
        setFlowStep("input");
    }, [invalidatePendingAnalysis, setFlowStep]);

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
                cancelAnalysisToInput();
                return true;
            }
            if (flowStep === "saving") return true;
            requestClose();
            return true;
        });
        return () => subscription.remove();
    }, [
        cancelAnalysisToInput,
        cancelEditField,
        flowStep,
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
        expandedCardHeight.value = withSpring(cardHeight, { ...CARD_SIZE_SPRING, reduceMotion: ReduceMotion.System });
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
        photoScanFrameStyle,
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
        flowStep: presentedStep,
        inputMode,
        isDark: mode === "dark",
        isPhotoRecognizing,
        isVoiceFinalizing,
        isVoiceRecording,
        photoRecognitionConfidence,
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
            keyboardVisible={keyboardTop !== undefined}
            mediaPanelBackground={mediaPanelBackground}
            mode={mode}
            modeIndicatorAnimatedStyle={modeIndicatorAnimatedStyle}
            onPhotoActionSheet={() => void openPhotoActionSheet()}
            onPhotoRecognitionRetry={retryPhotoRecognition}
            onPhotoTranscriptChange={editPhotoTranscript}
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
            photoScanFrameStyle={photoScanFrameStyle}
            photoTranscript={photoTranscript}
            photoTranscriptTruncated={photoTranscriptTruncated}
            segmentedBackground={segmentedBackground}
            selectedModeBackground={selectedModeBackground}
            selectedPhoto={selectedPhoto}
            setText={setText}
            submitting={submitting}
            showSubmitProgress={flowStep !== "analyzing"}
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

    /** 저장 중에도 확인한 일정 이름을 유지한다. */
    const renderLoadingStep = () => {
        const isSaving = flowStep === "saving";
        const analysisLabel = "일정을 확인하고 있어요";
        return (
            <QuickScheduleLoadingStep
                colors={colors}
                label={isSaving ? flowTitle : analysisLabel}
                description={isSaving ? previewDraft?.title : analysisLabel}
            />
        );
    };

    /** 분석 오류와 재시도 명령을 오류 단계 전용 화면에 전달한다. */
    const renderErrorStep = () => (
        <QuickScheduleErrorStep
            cardBorderColor={cardBorderColor}
            colors={colors}
            inputBackground={inputBackground}
            onEdit={() => {
                setInputReturning(true);
                setFlowStep("input");
            }}
            onRetry={submit}
            retainedInput={previewSourceText}
            submitting={submitting}
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
                initialScrollY={previewScrollY.current}
                mode={mode}
                onOpenEditField={openEditField}
                onOpenRoutePlanner={openRoutePlannerFromPreview}
                onSave={() => void savePreview()}
                onScrollPositionChange={y => { previewScrollY.current = y; }}
                onToggleSource={() => setPreviewSourceExpanded(expanded => !expanded)}
                previewCategoryChevronRotation={previewCategoryChevronRotation}
                previewCategoryPickerMarginBottom={previewCategoryPickerMarginBottom}
                previewCategoryPickerOpen={previewCategoryPickerOpen}
                previewCategoryPickerPaddingTop={previewCategoryPickerPaddingTop}
                previewDividerColor={previewDividerColor}
                previewDraft={previewDraft}
                destinationChanged={destinationChange}
                animateDestinationNotice={showNewDestinationNotice}
                routeDraftChange={routeDraftChange?.kind === "destinationChanged" ? undefined : routeDraftChange}
                previewIconBackground={previewIconBackground}
                previewLabelColor={previewLabelColor}
                previewSourceExpanded={previewSourceExpanded}
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
                routeDraftChange={routeDraftChange?.kind === "destinationChanged" ? undefined : routeDraftChange}
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
            timeLabel={previewDraft ? getPreviewValue(previewDraft, "time") : undefined}
            title={previewDraft?.title}
        />
    );

    const revealReviewBody = (key: string, body: React.ReactNode, animate = true) => (
        <Reanimated.View
            key={key}
            entering={animate ? FadeIn.duration(160).reduceMotion(ReduceMotion.System) : undefined}
            style={{ flex: 1 }}
        >
            {body}
        </Reanimated.View>
    );

    /** 현재 흐름 단계에 해당하는 전용 화면만 선택하여 렌더링한다. */
    const renderCurrentStep = () => {
        switch (presentedStep) {
            case "analyzing":
            case "saving":
                return renderLoadingStep();
            case "analysisError":
                return revealReviewBody("analysis-error", renderErrorStep());
            case "preview":
                return revealReviewBody("preview", renderPreviewStep(), showAnalysisWait || (returningFromField && !showNewDestinationNotice));
            case "edit":
                return renderEditStep();
            case "saved":
                return renderSavedStep();
            case "input":
            default:
                return inputReturning || largeText ? revealReviewBody("input-return", renderInputStep()) : renderInputStep();
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
            presentedStep={presentedStep}
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

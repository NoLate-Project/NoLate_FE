import { Ionicons } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as GoogleAuth from "expo-auth-session/providers/google";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { ComponentProps } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Animated,
    Alert,
    Easing,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createSchedule } from "../../src/api/schedule";
import { getScheduleCategoriesFromApi } from "../../src/api/scheduleCategories";
import {
    buildSchedulePayloadFromCandidate,
    getCalendarProviderLabel,
    getDefaultSelectedCandidateIds,
    getDeviceCalendarProvider,
    loadDeviceCalendarImportSummary,
    requestDeviceCalendarPermission,
    type DeviceCalendarCandidate,
    type DeviceCalendarImportSummary,
    type DeviceCalendarProvider,
} from "../../src/modules/onboarding/deviceCalendarImport";
import {
    GOOGLE_CALENDAR_CLIENT_ID,
    GOOGLE_CALENDAR_SCOPES,
    loadGoogleCalendarImportSummary,
    saveGoogleCalendarAccessToken,
} from "../../src/modules/onboarding/googleCalendarImport";
import {
    recordCalendarImportCompleted,
    recordCalendarScan,
} from "../../src/modules/onboarding/calendarConnectionStorage";
import QuickScheduleLogoLoader from "../../src/modules/schedule/components/form/QuickScheduleLogoLoader";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { ScheduleCategory, TravelMode } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";

type OnboardingStep = "intro" | "provider" | "permission" | "scanning" | "select" | "enrich" | "complete";
WebBrowser.maybeCompleteAuthSession();

const STEP_MOTION_DURATION_MS = 260;
const FOOTER_MOTION_DURATION_MS = 220;

type CalendarProviderId = "device" | "google";

type CalendarProviderOption = {
    id: CalendarProviderId;
    title: string;
    description: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    available: boolean;
    badge?: string;
};

type CandidateSourceGroup = {
    key: string;
    title: string;
    color?: string;
    totalCount: number;
    selectedCount: number;
};

type CalendarScanResult = {
    provider: DeviceCalendarProvider;
    providerLabel: string;
    summary: DeviceCalendarImportSummary;
};

const FALLBACK_CATEGORY: ScheduleCategory = {
    id: "1",
    title: "개인",
    color: "#2196f3",
};

const TRAVEL_MODES: Array<{
    value: TravelMode;
    label: string;
    icon: ComponentProps<typeof Ionicons>["name"];
}> = [
    { value: "TRANSIT", label: "대중교통", icon: "train-outline" },
    { value: "CAR", label: "자동차", icon: "car-outline" },
    { value: "WALK", label: "도보", icon: "walk-outline" },
];

const TRAVEL_MINUTES = [15, 30, 45, 60];

const SCAN_MESSAGES = [
    "캘린더 접근 확인 중",
    "다가오는 일정 확인 중",
    "장소가 있는 일정 정리 중",
];

const APP_LOGO = require("../../assets/icon.png");

export default function CalendarImportOnboarding() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);
    const { state, dispatch } = useScheduleStore();
    const deviceProviderLabel = getCalendarProviderLabel();
    const scrollViewRef = useRef<ScrollView>(null);
    const currentStepRef = useRef<OnboardingStep>("intro");
    const stepMotionDidMountRef = useRef(false);
    const stepMotion = useRef(new Animated.Value(1)).current;
    const footerMotion = useRef(new Animated.Value(1)).current;

    const [googleAuthRequest, , promptGoogleCalendarAuth] = GoogleAuth.useAuthRequest(
        {
            iosClientId: GOOGLE_CALENDAR_CLIENT_ID,
            androidClientId: GOOGLE_CALENDAR_CLIENT_ID,
            webClientId: GOOGLE_CALENDAR_CLIENT_ID,
            scopes: GOOGLE_CALENDAR_SCOPES,
            selectAccount: true,
            shouldAutoExchangeCode: false,
        },
        { scheme: "nolate" }
    );

    const [step, setStep] = useState<OnboardingStep>("intro");
    const [stepTransitionDirection, setStepTransitionDirection] = useState<1 | -1>(1);
    const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
    const [selectedProviderIds, setSelectedProviderIds] = useState<Set<CalendarProviderId>>(
        () => new Set(["device", "google"])
    );
    const [scanStage, setScanStage] = useState(0);
    const [candidates, setCandidates] = useState<DeviceCalendarCandidate[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [categoryId, setCategoryId] = useState(FALLBACK_CATEGORY.id);
    const [travelMode, setTravelMode] = useState<TravelMode>("TRANSIT");
    const [travelMinutes, setTravelMinutes] = useState(30);
    const [notificationEnabled, setNotificationEnabled] = useState(true);
    const [importing, setImporting] = useState(false);
    const [importedCount, setImportedCount] = useState(0);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const categories = useMemo(
        () => (state.categories.length > 0 ? state.categories : [FALLBACK_CATEGORY]),
        [state.categories]
    );
    const selectedCategory = useMemo(
        () => categories.find((category) => category.id === categoryId) ?? categories[0] ?? FALLBACK_CATEGORY,
        [categories, categoryId]
    );
    const selectedCandidates = useMemo(
        () => candidates.filter((candidate) => selectedIds.has(candidate.id)),
        [candidates, selectedIds]
    );
    const candidateSourceGroups = useMemo(
        () => buildCandidateSourceGroups(candidates, selectedIds),
        [candidates, selectedIds]
    );
    const allCandidatesSelected = candidates.length > 0 && selectedIds.size === candidates.length;
    const providerOptions = useMemo(
        () => buildCalendarProviderOptions(deviceProviderLabel),
        [deviceProviderLabel]
    );
    const providerCtaLabel = selectedProviderIds.size === 0
        ? "캘린더를 선택해 주세요"
        : "선택한 캘린더 연결하기";
    const permissionProviderLabel = useMemo(() => {
        const labels = [
            selectedProviderIds.has("device") ? deviceProviderLabel : null,
            selectedProviderIds.has("google") ? getCalendarProviderLabel("GOOGLE") : null,
        ].filter((label): label is string => Boolean(label));

        if (labels.length === 0) return "캘린더";
        if (labels.length === 1) return labels[0];
        return "선택한 캘린더";
    }, [deviceProviderLabel, selectedProviderIds]);
    const canGoBack = step !== "intro" && step !== "scanning" && step !== "complete" && !importing;

    const stepMotionStyle = {
        opacity: stepMotion,
        transform: [
            {
                translateX: stepMotion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [stepTransitionDirection * 18, 0],
                }),
            },
            {
                translateY: stepMotion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                }),
            },
            {
                scale: stepMotion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.985, 1],
                }),
            },
        ],
    };
    const footerMotionStyle = {
        opacity: footerMotion,
        transform: [
            {
                translateY: footerMotion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [14, 0],
                }),
            },
        ],
    };

    const goToStep = (nextStep: OnboardingStep) => {
        const currentStep = currentStepRef.current;
        const nextDirection = motionStepIndex(nextStep) < motionStepIndex(currentStep) ? -1 : 1;

        setStepTransitionDirection(nextDirection);
        currentStepRef.current = nextStep;
        setStep(nextStep);
    };

    useEffect(() => {
        let mounted = true;

        AccessibilityInfo.isReduceMotionEnabled()
            .then((enabled) => {
                if (mounted) setReduceMotionEnabled(enabled);
            })
            .catch(() => {});

        const subscription = AccessibilityInfo.addEventListener?.(
            "reduceMotionChanged",
            setReduceMotionEnabled
        );

        return () => {
            mounted = false;
            subscription?.remove?.();
        };
    }, []);

    useEffect(() => {
        currentStepRef.current = step;
        scrollViewRef.current?.scrollTo({ y: 0, animated: false });

        if (!stepMotionDidMountRef.current || reduceMotionEnabled) {
            stepMotionDidMountRef.current = true;
            stepMotion.setValue(1);
            footerMotion.setValue(1);
            return;
        }

        stepMotion.stopAnimation();
        footerMotion.stopAnimation();
        stepMotion.setValue(0);
        footerMotion.setValue(0);

        Animated.parallel([
            Animated.timing(stepMotion, {
                toValue: 1,
                duration: STEP_MOTION_DURATION_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(footerMotion, {
                toValue: 1,
                duration: FOOTER_MOTION_DURATION_MS,
                delay: 45,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();
    }, [footerMotion, reduceMotionEnabled, step, stepMotion]);

    useEffect(() => {
        let cancelled = false;

        getScheduleCategoriesFromApi()
            .then((nextCategories) => {
                if (cancelled || nextCategories.length === 0) return;
                dispatch({ type: "SET_CATEGORIES", categories: nextCategories });
                setCategoryId(nextCategories[0].id);
            })
            .catch(() => {
                // 온보딩은 가입 직후 첫 경험이므로 카테고리 조회 실패만으로 멈추지 않는다.
                // 일정 저장 payload에는 snapshot 형태의 category가 들어가므로 fallback으로도 진행 가능하다.
                setCategoryId(FALLBACK_CATEGORY.id);
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch]);

    const skipOnboarding = () => {
        router.replace("/schedule");
    };

    const goBackStep = () => {
        if (!canGoBack) return;

        switch (step) {
            case "provider":
                goToStep("intro");
                break;
            case "permission":
                goToStep("provider");
                break;
            case "select":
                goToStep("permission");
                break;
            case "enrich":
                goToStep("select");
                break;
            default:
                break;
        }
    };

    const toggleProvider = (providerId: CalendarProviderId) => {
        setSelectedProviderIds((current) => {
            const next = new Set(current);
            if (next.has(providerId)) {
                next.delete(providerId);
            } else {
                next.add(providerId);
            }
            return next;
        });
    };

    const scanCalendars = async () => {
        setErrorMessage(null);
        goToStep("scanning");
        setScanStage(0);

        try {
            const scans: CalendarScanResult[] = [];
            const failures: string[] = [];
            const wantsDeviceCalendar = selectedProviderIds.has("device");
            const wantsGoogleCalendar = selectedProviderIds.has("google");
            setScanStage(1);

            if (wantsDeviceCalendar) {
                const granted = await requestDeviceCalendarPermission();
                if (granted) {
                    scans.push({
                        provider: getDeviceCalendarProvider(),
                        providerLabel: deviceProviderLabel,
                        summary: await loadDeviceCalendarImportSummary(),
                    });
                } else {
                    failures.push(`${deviceProviderLabel} 권한이 꺼져 있어요.`);
                }
            }

            if (wantsGoogleCalendar) {
                const accessToken = await requestGoogleCalendarAccessToken();
                if (accessToken) {
                    scans.push({
                        provider: "GOOGLE",
                        providerLabel: getCalendarProviderLabel("GOOGLE"),
                        summary: await loadGoogleCalendarImportSummary(accessToken),
                    });
                } else {
                    failures.push("Google Calendar 연결이 취소됐어요.");
                }
            }

            if (scans.length === 0) {
                setErrorMessage(
                    failures.length > 0
                        ? failures.join("\n")
                        : "연결된 캘린더에서 일정을 불러오지 못했습니다."
                );
                goToStep("permission");
                return;
            }

            const loadedCandidates = mergeCalendarCandidates(
                scans.flatMap((scan) => scan.summary.candidates)
            );
            await recordCalendarScan({
                provider: scans[0].provider,
                providerLabel: scans.map((scan) => scan.providerLabel).join(" + "),
                providerLabels: scans.map((scan) => scan.providerLabel),
                calendarCount: scans.reduce((total, scan) => total + scan.summary.calendarCount, 0),
                calendarNames: scans.flatMap((scan) => scan.summary.calendarSources.map((calendar) => calendar.title)),
                eventCandidateCount: loadedCandidates.length,
            });
            setScanStage(2);
            setCandidates(loadedCandidates);
            setSelectedIds(getDefaultSelectedCandidateIds(loadedCandidates));
            goToStep("select");
        } catch (error) {
            setErrorMessage(getErrorMessage(error, "캘린더 일정을 불러오지 못했습니다."));
            goToStep("permission");
        }
    };

    const requestGoogleCalendarAccessToken = async (): Promise<string | null> => {
        if (!googleAuthRequest) {
            throw new Error("Google Calendar 연결 준비가 아직 끝나지 않았어요. 잠시 후 다시 시도해 주세요.");
        }

        const result = await promptGoogleCalendarAuth();
        if (result.type !== "success") return null;

        if (result.authentication?.accessToken) {
            await saveGoogleCalendarAccessToken({
                accessToken: result.authentication.accessToken,
                expiresIn: result.authentication.expiresIn,
            });
            return result.authentication.accessToken;
        }

        const code = result.params.code;
        if (!code || !googleAuthRequest.codeVerifier) {
            throw new Error("Google Calendar 인증 코드를 확인하지 못했습니다.");
        }

        const tokenResponse = await AuthSession.exchangeCodeAsync(
            {
                clientId: GOOGLE_CALENDAR_CLIENT_ID,
                code,
                redirectUri: googleAuthRequest.redirectUri,
                scopes: GOOGLE_CALENDAR_SCOPES,
                extraParams: {
                    code_verifier: googleAuthRequest.codeVerifier,
                },
            },
            GoogleAuth.discovery
        );

        await saveGoogleCalendarAccessToken({
            accessToken: tokenResponse.accessToken,
            expiresIn: tokenResponse.expiresIn,
        });
        return tokenResponse.accessToken;
    };

    const toggleCandidate = (candidate: DeviceCalendarCandidate) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(candidate.id)) {
                next.delete(candidate.id);
            } else {
                next.add(candidate.id);
            }
            return next;
        });
    };

    const selectAllCandidates = () => {
        setSelectedIds(new Set(candidates.map((candidate) => candidate.id)));
    };

    const clearSelectedCandidates = () => {
        setSelectedIds(new Set());
    };

    const toggleCandidateSourceGroup = (sourceKey: string) => {
        const targetIds = candidates
            .filter((candidate) => candidate.calendarId === sourceKey)
            .map((candidate) => candidate.id);

        if (targetIds.length === 0) return;

        setSelectedIds((current) => {
            const next = new Set(current);
            const everySelected = targetIds.every((id) => next.has(id));

            for (const id of targetIds) {
                if (everySelected) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
            }

            return next;
        });
    };

    const importSelectedSchedules = async () => {
        if (selectedCandidates.length === 0 || importing) return;

        try {
            setImporting(true);
            let successCount = 0;

            // 순차 저장을 사용한다. 가입 직후 네트워크가 불안정할 때 일부만 실패해도
            // 어떤 일정까지 저장됐는지 디버깅하기 쉽고, 서버 부하도 작게 유지된다.
            for (const candidate of selectedCandidates) {
                const item = await createSchedule(
                    buildSchedulePayloadFromCandidate(candidate, {
                        category: selectedCategory,
                        travelMode,
                        travelMinutes,
                        notificationEnabled,
                    })
                );
                dispatch({ type: "ADD_ITEM", item });
                successCount += 1;
            }

            setImportedCount(successCount);
            await recordCalendarImportCompleted(successCount);
            goToStep("complete");
        } catch (error) {
            Alert.alert("가져오기 실패", getErrorMessage(error, "선택한 일정을 가져오지 못했습니다."));
        } finally {
            setImporting(false);
        }
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 18) }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={styles.topRow}>
                <Pressable
                    disabled={!canGoBack}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="이전 단계로 돌아가기"
                    onPress={goBackStep}
                    style={({ pressed }) => [
                        styles.backButton,
                        !canGoBack && styles.backButtonHidden,
                        pressed && canGoBack && styles.pressed,
                    ]}
                >
                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                </Pressable>
            </View>

            <ScrollView
                ref={scrollViewRef}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
            >
                <Animated.View style={[styles.stepMotion, stepMotionStyle]}>
                {step === "intro" && (
                    <View style={[styles.stepWrap, styles.introWrap]}>
                        <View style={styles.introLogoWrap}>
                            <Image source={APP_LOGO} resizeMode="cover" style={styles.introLogoImage} />
                        </View>
                        <Text style={styles.title}>캘린더를 연결하면{"\n"}출발 준비가 쉬워져요</Text>
                        <Text style={styles.subtitle}>
                            필요한 일정만 찾아 NoLate에 가져올게요.
                        </Text>

                        <View style={styles.introPointList}>
                            <IntroPoint label="원본 캘린더는 바꾸지 않아요" />
                            <IntroPoint label="가져올 일정은 직접 고를 수 있어요" />
                        </View>
                    </View>
                )}

                {step === "provider" && (
                    <View style={styles.stepWrap}>
                        <Text style={styles.eyebrow}>캘린더 선택</Text>
                        <Text style={styles.title}>어디에서 일정을{"\n"}가져올까요?</Text>
                        <Text style={styles.subtitle}>
                            연결하고 싶은 캘린더를 체크해 주세요. 이어서 가져올 일정만 골라볼게요.
                        </Text>

                        <View style={styles.providerList}>
                            {providerOptions.map((provider) => (
                                <ProviderOptionRow
                                    key={provider.id}
                                    provider={provider}
                                    selected={selectedProviderIds.has(provider.id)}
                                    onPress={() => toggleProvider(provider.id)}
                                />
                            ))}
                        </View>
                    </View>
                )}

                {step === "permission" && (
                    <View style={styles.stepWrap}>
                        <StepIcon name={Platform.OS === "ios" ? "calendar-outline" : "phone-portrait-outline"} />
                        <Text style={styles.title}>{permissionProviderLabel}에서{"\n"}다가오는 일정을 찾아볼게요</Text>
                        <Text style={styles.subtitle}>
                            가져올 일정은 직접 고르고, 원본 캘린더는 수정하지 않습니다.
                        </Text>
                        {errorMessage ? (
                            <View style={styles.inlineNotice}>
                                <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                                <Text style={styles.inlineNoticeText}>{errorMessage}</Text>
                            </View>
                        ) : null}
                    </View>
                )}

                {step === "scanning" && (
                    <View style={styles.stepWrap}>
                        <QuickScheduleLogoLoader
                            variant="calendar"
                            accessibilityLabel={`다가오는 일정을 찾고 있어요. ${SCAN_MESSAGES[Math.min(scanStage, SCAN_MESSAGES.length - 1)]}`}
                        />
                        <Text style={styles.title}>다가오는 일정을{"\n"}찾고 있어요</Text>
                        <View style={styles.scanList}>
                            {SCAN_MESSAGES.map((message, index) => (
                                <View key={message} style={styles.scanRow}>
                                    <Ionicons
                                        name={scanStage >= index ? "checkmark-circle" : "ellipse-outline"}
                                        size={19}
                                        color={scanStage >= index ? colors.textPrimary : colors.textDisabled}
                                    />
                                    <Text
                                        style={[
                                            styles.scanText,
                                            { color: scanStage >= index ? colors.textPrimary : colors.textSecondary },
                                        ]}
                                    >
                                        {message}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {step === "select" && (
                    <View style={styles.stepWrap}>
                        <Text pointerEvents="none" style={styles.eyebrow}>{candidates.length}개의 일정 후보</Text>
                        <Text pointerEvents="none" style={styles.title}>
                            가져오면 좋은 일정{selectedIds.size > 0 ? ` ${selectedIds.size}개` : ""}를 골랐어요
                        </Text>
                        <Text pointerEvents="none" style={styles.subtitle}>
                            장소와 시간이 있는 일정은 기본으로 선택했고, 종일 일정도 직접 고를 수 있어요.
                        </Text>

                        {candidates.length === 0 ? (
                            <View style={styles.emptyBox}>
                                <Ionicons name="calendar-clear-outline" size={34} color={colors.textDisabled} />
                                <Text style={styles.emptyTitle}>가져올 일정이 없어요</Text>
                                <Text style={styles.emptyText}>일정 화면에서 직접 첫 일정을 만들 수 있습니다.</Text>
                            </View>
                        ) : (
                            <>
                                <View style={styles.selectionControlList}>
                                    <SelectionControlRow
                                        title={allCandidatesSelected ? "전체 일정 선택됨" : "전체 일정 선택"}
                                        description={`${candidates.length}개 후보 모두 가져오기`}
                                        icon="checkmark-done-outline"
                                        active={allCandidatesSelected}
                                        onPress={selectAllCandidates}
                                    />
                                    <SelectionControlRow
                                        title="선택 모두 해제"
                                        description="필요한 일정만 다시 고르기"
                                        icon="remove-circle-outline"
                                        active={selectedIds.size === 0}
                                        onPress={clearSelectedCandidates}
                                    />
                                </View>

                                {candidateSourceGroups.length > 1 ? (
                                    <>
                                        <SectionTitle label="원본 캘린더별 선택" />
                                        <View style={styles.sourceGroupList}>
                                            {candidateSourceGroups.map((group) => (
                                                <CandidateSourceRow
                                                    key={group.key}
                                                    group={group}
                                                    active={group.selectedCount === group.totalCount}
                                                    onPress={() => toggleCandidateSourceGroup(group.key)}
                                                />
                                            ))}
                                        </View>
                                    </>
                                ) : null}

                                <View style={styles.candidateList}>
                                    {candidates.slice(0, 20).map((candidate) => (
                                        <CandidateRow
                                            key={candidate.id}
                                            candidate={candidate}
                                            selected={selectedIds.has(candidate.id)}
                                            onPress={() => toggleCandidate(candidate)}
                                        />
                                    ))}
                                </View>
                            </>
                        )}
                    </View>
                )}

                {step === "enrich" && (
                    <View style={styles.stepWrap}>
                        <Text style={styles.eyebrow}>{selectedCandidates.length}개 일정 가져오기</Text>
                        <Text style={styles.title}>출발 알림은{"\n"}이렇게 준비할게요</Text>
                        <Text style={styles.subtitle}>
                            지금은 공통값만 정하고, 일정 화면에서 하나씩 수정할 수 있어요.
                        </Text>

                        <SectionTitle label="카테고리" />
                        <View style={styles.chipRow}>
                            {categories.map((category) => (
                                <OptionChip
                                    key={category.id}
                                    label={category.title}
                                    active={category.id === selectedCategory.id}
                                    color={category.color}
                                    onPress={() => setCategoryId(category.id)}
                                />
                            ))}
                        </View>

                        <SectionTitle label="이동수단" />
                        <View style={styles.chipRow}>
                            {TRAVEL_MODES.map((option) => (
                                <OptionChip
                                    key={option.value}
                                    label={option.label}
                                    icon={option.icon}
                                    active={travelMode === option.value}
                                    onPress={() => setTravelMode(option.value)}
                                />
                            ))}
                        </View>

                        <SectionTitle label="예상 이동시간" />
                        <View style={styles.chipRow}>
                            {TRAVEL_MINUTES.map((minutes) => (
                                <OptionChip
                                    key={minutes}
                                    label={`${minutes}분`}
                                    active={travelMinutes === minutes}
                                    onPress={() => setTravelMinutes(minutes)}
                                />
                            ))}
                        </View>

                        <View style={styles.switchRow}>
                            <View style={styles.switchTextWrap}>
                                <Text style={styles.switchTitle}>출발 알림</Text>
                                <Text style={styles.switchHint}>일정 시작 15분 전부터 확인</Text>
                            </View>
                            <Switch
                                value={notificationEnabled}
                                onValueChange={setNotificationEnabled}
                                trackColor={{
                                    false: mode === "dark" ? "#34363D" : "#D7D9DF",
                                    true: colors.selectedDayBg,
                                }}
                                thumbColor={notificationEnabled ? colors.selectedDayText : "#FFFFFF"}
                            />
                        </View>
                    </View>
                )}

                {step === "complete" && (
                    <View style={styles.stepWrap}>
                        <StepIcon name="checkmark-circle-outline" />
                        <Text style={styles.title}>일정 {importedCount}개를{"\n"}NoLate에 추가했어요</Text>
                        <Text style={styles.subtitle}>
                            장소가 있는 일정은 출발 시간을 기준으로 다시 다듬을 수 있습니다.
                        </Text>
                    </View>
                )}
                </Animated.View>
            </ScrollView>

            <Animated.View style={[styles.footer, footerMotionStyle]}>
                {step === "intro" && (
                    <>
                        <PrimaryButton label="일정 불러오기" onPress={() => goToStep("provider")} />
                        <GhostButton label="일정 없이 시작하기" onPress={skipOnboarding} />
                    </>
                )}
                {step === "provider" && (
                    <>
                        <PrimaryButton
                            label={providerCtaLabel}
                            disabled={selectedProviderIds.size === 0}
                            onPress={() => goToStep("permission")}
                        />
                        <GhostButton label="일정 없이 시작하기" onPress={skipOnboarding} />
                    </>
                )}
                {step === "permission" && (
                    <>
                        <PrimaryButton label="계속하기" onPress={scanCalendars} />
                        <GhostButton label="나중에 할게요" onPress={skipOnboarding} />
                    </>
                )}
                {step === "scanning" && null}
                {step === "select" && (
                    <>
                        <PrimaryButton
                            label={selectedIds.size > 0 ? `선택한 일정 ${selectedIds.size}개 가져오기` : "전체 일정 선택하기"}
                            onPress={selectedIds.size > 0 ? () => goToStep("enrich") : selectAllCandidates}
                        />
                        <GhostButton label="이전으로" onPress={goBackStep} />
                    </>
                )}
                {step === "enrich" && (
                    <>
                        <PrimaryButton
                            label={importing ? "가져오는 중" : "가져오기 완료"}
                            disabled={importing}
                            onPress={importSelectedSchedules}
                        />
                        <GhostButton label="이전으로" disabled={importing} onPress={() => goToStep("select")} />
                    </>
                )}
                {step === "complete" && (
                    <PrimaryButton label="내 일정 보기" onPress={skipOnboarding} />
                )}
            </Animated.View>
        </View>
    );
}

function StepIcon({ name }: { name: ComponentProps<typeof Ionicons>["name"] }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={styles.stepIcon}>
            <Ionicons name={name} size={28} color={colors.selectedDayText} />
        </View>
    );
}

function IntroPoint({ label }: { label: string }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={styles.introPoint}>
            <Ionicons name="checkmark-circle" size={18} color={colors.textPrimary} />
            <Text style={styles.introPointText}>{label}</Text>
        </View>
    );
}

function ProviderOptionRow({
    provider,
    selected,
    onPress,
}: {
    provider: CalendarProviderOption;
    selected: boolean;
    onPress: () => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.providerRow,
                selected && styles.providerRowSelected,
                pressed && styles.pressed,
            ]}
        >
            <View style={[styles.providerIconWrap, !provider.available && styles.providerIconMuted]}>
                <Ionicons
                    name={provider.icon}
                    size={22}
                    color={provider.available ? colors.textPrimary : colors.textSecondary}
                />
            </View>
            <View style={styles.providerCopy}>
                <View style={styles.providerTitleRow}>
                    <Text numberOfLines={1} style={styles.providerTitle}>
                        {provider.title}
                    </Text>
                    {provider.badge ? (
                        <View style={styles.providerBadge}>
                            <Text style={styles.providerBadgeText}>{provider.badge}</Text>
                        </View>
                    ) : null}
                </View>
                <Text numberOfLines={2} style={styles.providerDescription}>
                    {provider.description}
                </Text>
            </View>
            <View style={[styles.providerCheck, selected && styles.providerCheckSelected]}>
                {selected ? <Ionicons name="checkmark" size={14} color={colors.selectedDayText} /> : null}
            </View>
        </Pressable>
    );
}

function SelectionControlRow({
    title,
    description,
    icon,
    active,
    onPress,
}: {
    title: string;
    description: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    active: boolean;
    onPress: () => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View
            accessible
            accessibilityRole="button"
            onStartShouldSetResponder={() => true}
            onResponderRelease={onPress}
            style={[
                styles.selectionControlRow,
                active && styles.selectionControlRowActive,
            ]}
        >
            <View style={[styles.selectionControlIcon, active && styles.selectionControlIconActive]}>
                <Ionicons
                    name={icon}
                    size={16}
                    color={active ? colors.selectedDayText : colors.textPrimary}
                />
            </View>
            <View style={styles.selectionControlCopy}>
                <Text style={styles.selectionControlTitle}>{title}</Text>
            <Text style={styles.selectionControlDescription}>{description}</Text>
            </View>
        </View>
    );
}

function CandidateSourceRow({
    group,
    active,
    onPress,
}: {
    group: CandidateSourceGroup;
    active: boolean;
    onPress: () => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View
            accessible
            accessibilityRole="button"
            onStartShouldSetResponder={() => true}
            onResponderRelease={onPress}
            style={[
                styles.sourceGroupButton,
                active && styles.sourceGroupButtonActive,
            ]}
        >
            <View style={[styles.checkCircle, active && styles.checkCircleSelected]}>
                {active ? <Ionicons name="checkmark" size={14} color={colors.selectedDayText} /> : null}
            </View>
            <View style={[styles.sourceGroupDot, { backgroundColor: group.color ?? colors.textDisabled }]} />
            <View style={styles.sourceGroupCopy}>
                <Text numberOfLines={1} style={styles.sourceGroupText}>
                    {group.title}
                </Text>
                <Text style={styles.sourceGroupCount}>
                    {group.selectedCount}/{group.totalCount}개 선택
                </Text>
            </View>
        </View>
    );
}

function SectionTitle({ label }: { label: string }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);
    return <Text style={styles.sectionTitle}>{label}</Text>;
}

function CandidateRow({
    candidate,
    selected,
    onPress,
}: {
    candidate: DeviceCalendarCandidate;
    selected: boolean;
    onPress: () => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.candidateRow,
                selected && styles.candidateRowSelected,
                candidate.requiresTimeReview && styles.candidateRowReview,
                pressed && styles.pressed,
            ]}
        >
            <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
                {selected ? <Ionicons name="checkmark" size={14} color={colors.selectedDayText} /> : null}
            </View>
            <View style={styles.candidateBody}>
                <View style={styles.candidateTitleRow}>
                    <Text numberOfLines={1} style={styles.candidateTitle}>
                        {candidate.title}
                    </Text>
                    {candidate.recommended ? <Text style={styles.recommendedBadge}>추천</Text> : null}
                </View>
                <Text numberOfLines={1} style={styles.candidateMeta}>
                    {formatCandidateDate(candidate)}
                    {candidate.locationName ? ` · ${candidate.locationName}` : ""}
                </Text>
                <View style={styles.calendarSourceRow}>
                    <View
                        style={[
                            styles.calendarSourceDot,
                            { backgroundColor: candidate.calendarColor ?? colors.textDisabled },
                        ]}
                    />
                    <Text numberOfLines={1} style={styles.calendarSourceText}>
                        {candidate.requiresTimeReview ? "종일 일정으로 가져오기" : candidate.calendarTitle}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

function OptionChip({
    label,
    active,
    onPress,
    icon,
    color,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    icon?: ComponentProps<typeof Ionicons>["name"];
    color?: string;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.optionChip,
                active && styles.optionChipActive,
                pressed && styles.pressed,
            ]}
        >
            {icon ? (
                <Ionicons
                    name={icon}
                    size={16}
                    color={active ? colors.selectedDayText : colors.textSecondary}
                />
            ) : color ? (
                <View style={[styles.optionColorDot, { backgroundColor: color }]} />
            ) : null}
            <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>
                {label}
            </Text>
        </Pressable>
    );
}

function PrimaryButton({
    label,
    disabled,
    onPress,
}: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.primaryButton,
                disabled && styles.disabled,
                pressed && !disabled && styles.pressed,
            ]}
        >
            <Text style={styles.primaryButtonText}>{label}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.selectedDayText} />
        </Pressable>
    );
}

function GhostButton({
    label,
    disabled,
    onPress,
}: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
            <Text style={[styles.ghostButtonText, disabled && styles.disabledText]}>{label}</Text>
        </Pressable>
    );
}

function motionStepIndex(step: OnboardingStep): number {
    switch (step) {
        case "intro":
            return 0;
        case "provider":
            return 1;
        case "permission":
            return 2;
        case "scanning":
            return 3;
        case "select":
            return 4;
        case "enrich":
            return 5;
        case "complete":
            return 6;
    }
}

function formatCandidateDate(candidate: DeviceCalendarCandidate): string {
    if (candidate.allDay) return "종일";

    const date = new Date(candidate.startAt);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}월 ${day}일 ${hour}:${minute}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function buildCalendarProviderOptions(deviceProviderLabel: string): CalendarProviderOption[] {
    const deviceDescription = Platform.OS === "ios"
        ? "iPhone에 동기화된 캘린더"
        : "Android에 동기화된 캘린더";

    return [
        {
            id: "device",
            title: deviceProviderLabel,
            description: deviceDescription,
            icon: Platform.OS === "ios" ? "logo-apple" : "phone-portrait-outline",
            available: true,
            badge: "바로 연결",
        },
        {
            id: "google",
            title: "Google Calendar",
            description: "Google 계정에서 일정 가져오기",
            icon: "logo-google",
            available: true,
            badge: "직접 연결",
        },
    ];
}

function mergeCalendarCandidates(candidates: DeviceCalendarCandidate[]): DeviceCalendarCandidate[] {
    const seen = new Set<string>();

    return candidates
        .filter((candidate) => {
            const key = [
                candidate.title.trim().toLowerCase(),
                candidate.startAt,
                candidate.endAt,
                candidate.locationName?.trim().toLowerCase() ?? "",
            ].join("|");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort(compareCandidatesForDisplay);
}

function compareCandidatesForDisplay(a: DeviceCalendarCandidate, b: DeviceCalendarCandidate): number {
    if (a.recommended !== b.recommended) {
        return a.recommended ? -1 : 1;
    }

    if (a.requiresTimeReview !== b.requiresTimeReview) {
        return a.requiresTimeReview ? 1 : -1;
    }

    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
}

function buildCandidateSourceGroups(
    candidates: DeviceCalendarCandidate[],
    selectedIds: Set<string>
): CandidateSourceGroup[] {
    const groups = new Map<string, CandidateSourceGroup>();

    for (const candidate of candidates) {
        const current = groups.get(candidate.calendarId);
        if (current) {
            current.totalCount += 1;
            if (selectedIds.has(candidate.id)) current.selectedCount += 1;
            continue;
        }

        groups.set(candidate.calendarId, {
            key: candidate.calendarId,
            title: candidate.calendarTitle,
            color: candidate.calendarColor,
            totalCount: 1,
            selectedCount: selectedIds.has(candidate.id) ? 1 : 0,
        });
    }

    return Array.from(groups.values()).sort((a, b) => a.title.localeCompare(b.title, "ko"));
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"], mode: "dark" | "light") {
    const isDark = mode === "dark";

    return StyleSheet.create({
        root: {
            flex: 1,
            backgroundColor: isDark ? "#0F1115" : "#F8F9FB",
            paddingHorizontal: 22,
        },
        topRow: {
            minHeight: 36,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        backButton: {
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)",
        },
        backButtonHidden: {
            opacity: 0,
        },
        content: {
            flexGrow: 1,
            justifyContent: "center",
            paddingTop: 32,
            paddingBottom: 22,
        },
        stepMotion: {
            width: "100%",
        },
        stepWrap: {
            gap: 16,
        },
        introWrap: {
            gap: 15,
            paddingBottom: 12,
        },
        introLogoWrap: {
            width: 68,
            height: 68,
            borderRadius: 20,
            overflow: "hidden",
            backgroundColor: "#0A84FF",
            marginBottom: 12,
        },
        introLogoImage: {
            width: "100%",
            height: "100%",
        },
        stepIcon: {
            width: 60,
            height: 60,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.selectedDayBg,
            marginBottom: 8,
        },
        eyebrow: {
            color: colors.textSecondary,
            fontSize: 13,
            lineHeight: 18,
            fontWeight: "900",
        },
        title: {
            color: colors.textPrimary,
            fontSize: 30,
            lineHeight: 38,
            fontWeight: "900",
            letterSpacing: 0,
        },
        subtitle: {
            maxWidth: 310,
            color: colors.textSecondary,
            fontSize: 15,
            lineHeight: 23,
            fontWeight: "700",
        },
        introPointList: {
            gap: 10,
            marginTop: 8,
        },
        introPoint: {
            minHeight: 28,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        introPointText: {
            color: colors.textSecondary,
            fontSize: 14,
            lineHeight: 20,
            fontWeight: "800",
        },
        providerList: {
            gap: 10,
            marginTop: 6,
        },
        providerRow: {
            minHeight: 68,
            borderRadius: 17,
            paddingHorizontal: 14,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: isDark ? "#17191F" : "#FFFFFF",
            borderWidth: 1,
            borderColor: colors.border,
        },
        providerRowSelected: {
            borderColor: colors.textPrimary,
        },
        providerIconWrap: {
            width: 38,
            height: 38,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)",
        },
        providerIconMuted: {
            opacity: 0.62,
        },
        providerCopy: {
            flex: 1,
            minWidth: 0,
            gap: 4,
        },
        providerTitleRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            minWidth: 0,
        },
        providerTitle: {
            flexShrink: 1,
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "900",
        },
        providerDescription: {
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 16,
            fontWeight: "800",
        },
        providerBadge: {
            borderRadius: 9,
            paddingHorizontal: 7,
            paddingVertical: 3,
            backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
        },
        providerBadgeText: {
            color: colors.textSecondary,
            fontSize: 10,
            fontWeight: "900",
        },
        providerCheck: {
            width: 25,
            height: 25,
            borderRadius: 7,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: isDark ? "#16181D" : "#FFFFFF",
        },
        providerCheckSelected: {
            backgroundColor: colors.selectedDayBg,
            borderColor: colors.selectedDayBg,
        },
        providerNotice: {
            minHeight: 46,
            borderRadius: 15,
            paddingHorizontal: 12,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        },
        providerNoticeText: {
            flex: 1,
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 17,
            fontWeight: "800",
        },
        inlineNotice: {
            borderRadius: 16,
            padding: 14,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 9,
            backgroundColor: colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
        },
        inlineNoticeText: {
            flex: 1,
            color: colors.textSecondary,
            fontSize: 13,
            lineHeight: 19,
            fontWeight: "700",
        },
        scanList: {
            marginTop: 10,
            gap: 12,
        },
        scanRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        scanText: {
            fontSize: 14,
            fontWeight: "800",
        },
        emptyBox: {
            minHeight: 174,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            padding: 18,
        },
        emptyTitle: {
            color: colors.textPrimary,
            fontSize: 16,
            fontWeight: "900",
        },
        emptyText: {
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: "700",
            textAlign: "center",
        },
        selectionControlList: {
            gap: 8,
        },
        selectionControlRow: {
            minHeight: 58,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.border,
        },
        selectionControlRowActive: {
            borderColor: colors.textPrimary,
        },
        selectionControlIcon: {
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isDark ? "#1D2027" : "#FFFFFF",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
        },
        selectionControlIconActive: {
            backgroundColor: colors.selectedDayBg,
            borderColor: colors.selectedDayBg,
        },
        selectionControlCopy: {
            flex: 1,
            gap: 3,
        },
        selectionControlTitle: {
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "900",
        },
        selectionControlDescription: {
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 16,
            fontWeight: "800",
        },
        sourceGroupList: {
            gap: 8,
        },
        sourceGroupButton: {
            minHeight: 58,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.border,
        },
        sourceGroupButtonActive: {
            borderColor: colors.textPrimary,
        },
        sourceGroupDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
        },
        sourceGroupCopy: {
            flex: 1,
            minWidth: 0,
            gap: 3,
        },
        sourceGroupText: {
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "900",
        },
        sourceGroupCount: {
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 16,
            fontWeight: "800",
        },
        candidateList: {
            gap: 10,
        },
        candidateRow: {
            minHeight: 82,
            borderRadius: 18,
            padding: 14,
            flexDirection: "row",
            gap: 12,
            alignItems: "center",
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.border,
        },
        candidateRowSelected: {
            borderColor: colors.textPrimary,
        },
        candidateRowReview: {
            backgroundColor: isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.72)",
        },
        checkCircle: {
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: isDark ? "#16181D" : "#FFFFFF",
        },
        checkCircleSelected: {
            backgroundColor: colors.selectedDayBg,
            borderColor: colors.selectedDayBg,
        },
        candidateBody: {
            flex: 1,
            minWidth: 0,
            gap: 5,
        },
        candidateTitleRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
        },
        candidateTitle: {
            flex: 1,
            minWidth: 0,
            color: colors.textPrimary,
            fontSize: 15,
            fontWeight: "900",
        },
        recommendedBadge: {
            overflow: "hidden",
            borderRadius: 9,
            paddingHorizontal: 7,
            paddingVertical: 3,
            color: colors.selectedDayText,
            backgroundColor: colors.selectedDayBg,
            fontSize: 10,
            fontWeight: "900",
        },
        candidateMeta: {
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 17,
            fontWeight: "800",
        },
        calendarSourceRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
        },
        calendarSourceDot: {
            width: 7,
            height: 7,
            borderRadius: 4,
        },
        calendarSourceText: {
            flex: 1,
            minWidth: 0,
            color: colors.textSecondary,
            fontSize: 11,
            fontWeight: "800",
        },
        sectionTitle: {
            marginTop: 10,
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: "900",
        },
        chipRow: {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
        },
        optionChip: {
            minHeight: 42,
            borderRadius: 15,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
            paddingHorizontal: 13,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
        },
        optionChipActive: {
            backgroundColor: colors.selectedDayBg,
            borderColor: colors.selectedDayBg,
        },
        optionChipText: {
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: "900",
        },
        optionChipTextActive: {
            color: colors.selectedDayText,
        },
        optionColorDot: {
            width: 9,
            height: 9,
            borderRadius: 5,
        },
        switchRow: {
            marginTop: 10,
            minHeight: 70,
            borderRadius: 18,
            paddingHorizontal: 15,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            backgroundColor: colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
        },
        switchTextWrap: {
            flex: 1,
            minWidth: 0,
        },
        switchTitle: {
            color: colors.textPrimary,
            fontSize: 15,
            fontWeight: "900",
        },
        switchHint: {
            marginTop: 4,
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: "800",
        },
        footer: {
            gap: 12,
        },
        primaryButton: {
            minHeight: 56,
            borderRadius: 18,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: colors.selectedDayBg,
        },
        primaryButtonText: {
            color: colors.selectedDayText,
            fontSize: 15,
            fontWeight: "900",
        },
        ghostButtonText: {
            color: colors.textSecondary,
            textAlign: "center",
            fontSize: 14,
            lineHeight: 22,
            fontWeight: "900",
            paddingVertical: 4,
        },
        disabled: {
            opacity: 0.55,
        },
        disabledText: {
            opacity: 0.55,
        },
        pressed: {
            opacity: 0.72,
            transform: [{ scale: 0.99 }],
        },
    });
}

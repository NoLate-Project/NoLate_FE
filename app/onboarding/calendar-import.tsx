import { Ionicons } from "@expo/vector-icons";
import { usePreventRemove } from "@react-navigation/native";
import * as AuthSession from "expo-auth-session";
import * as GoogleAuth from "expo-auth-session/providers/google";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Animated,
    Alert,
    BackHandler,
    Easing,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { importCalendarSchedule, type SchedulePayload } from "../../src/api/schedule";
import { completeMemberCuration } from "../../src/api/member";
import { getScheduleCategoriesFromApi } from "../../src/api/scheduleCategories";
import {
    FREE_SUBSCRIPTION_POLICY,
    getMySubscriptionPolicy,
    type SubscriptionPolicy,
} from "../../src/api/subscription";
import {
    getRouteAlternativeOptions,
    searchAddressByKeyword,
    type PlaceSearchItem,
    type RoutePathCoord,
} from "../../src/modules/map/routingService";
import {
    buildSchedulePayloadFromCandidate,
    buildCalendarImportSource,
    getCalendarProviderLabel,
    getDefaultSelectedCandidateIds,
    getDeviceCalendarProvider,
    loadDeviceCalendarImportSummary,
    requestDeviceCalendarPermission,
    type DeviceCalendarCandidate,
} from "../../src/modules/onboarding/deviceCalendarImport";
import { withCalendarImportTimeout } from "../../src/modules/onboarding/calendarImportReliability";
import {
    isCalendarImportManagementEntry,
    shouldConsumeCalendarImportHardwareBack,
} from "../../src/modules/onboarding/calendarImportNavigation";
import {
    getWritableCalendarImportCategories,
    resolveCalendarImportCategory,
} from "../../src/modules/onboarding/calendarImportCategory";
import CalendarImportCategoryCreator from "../../src/modules/onboarding/CalendarImportCategoryCreator";
import {
    enableCalendarImportNotification,
    enrichCalendarCandidateWithRoute,
    extractCalendarRouteHints,
} from "../../src/modules/onboarding/calendarImportRouteEnrichment";
import {
    scanSelectedCalendarProviders,
    type CalendarProviderScanFailure,
    type CalendarScanProgress,
} from "../../src/modules/onboarding/calendarImportScan";
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
import { useAuth } from "../../src/modules/auth/AuthContext";
import { saveAuthCurationCompleted } from "../../src/modules/auth/authStorage";
import {
    getFavoriteDeparturePlaces,
    hasFavoriteDepartureCoords,
    saveFavoriteDeparturePlace,
} from "../../src/modules/schedule/favoriteDeparture";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { Place, ScheduleCategory, TravelMode } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";

type OnboardingStep = "intro" | "provider" | "permission" | "scanning" | "select" | "enrich" | "complete";
WebBrowser.maybeCompleteAuthSession();

const STEP_MOTION_DURATION_MS = 260;
const FOOTER_MOTION_DURATION_MS = 220;

type CalendarProviderId = "device" | "google";
type CalendarConsentId = "device_access" | "google_access" | "candidate_review" | "selected_schedule_storage";

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

type CalendarConsentItem = {
    id: CalendarConsentId;
    title: string;
    summary: string;
    detail: string[];
    required: boolean;
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
    "캘린더 연결 확인",
    "다가오는 일정 찾기",
    "가져올 일정 정리",
];

const GOOGLE_AUTH_TIMEOUT_MS = 120_000;
const GOOGLE_TOKEN_EXCHANGE_TIMEOUT_MS = 20_000;
const SECURE_STORAGE_TIMEOUT_MS = 8_000;
const PLACE_SEARCH_TIMEOUT_MS = 15_000;
const ROUTE_SEARCH_TIMEOUT_MS = 25_000;
const IMPORT_BATCH_SIZE = 3;
const CANDIDATE_PAGE_SIZE = 20;
const CURATION_PROGRESS_SEGMENT_COUNT = 6;

const APP_LOGO = require("../../assets/icon.png");
const BRAND_BLUE = "#246BFE";

export default function CalendarImportOnboarding() {
    const router = useRouter();
    const { source } = useLocalSearchParams<{ source?: string | string[] }>();
    const { isCurationCompleted, syncAuthentication } = useAuth();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);
    const { state, dispatch } = useScheduleStore();
    const deviceProviderLabel = getCalendarProviderLabel();
    const scrollViewRef = useRef<ScrollView>(null);
    const currentStepRef = useRef<OnboardingStep>("intro");
    const scanAttemptRef = useRef(0);
    const stepMotionDidMountRef = useRef(false);
    const stepMotion = useRef(new Animated.Value(1)).current;
    const footerMotion = useRef(new Animated.Value(1)).current;
    const goBackStepRef = useRef<() => void>(() => undefined);

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
        () => new Set(["device"])
    );
    const [acceptedCalendarConsentIds, setAcceptedCalendarConsentIds] = useState<Set<CalendarConsentId>>(
        () => new Set()
    );
    const [expandedCalendarConsentIds, setExpandedCalendarConsentIds] = useState<Set<CalendarConsentId>>(
        () => new Set()
    );
    const [scanStage, setScanStage] = useState(0);
    const [scanStatusMessage, setScanStatusMessage] = useState("캘린더 연결을 확인하고 있어요");
    const [candidates, setCandidates] = useState<DeviceCalendarCandidate[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [visibleCandidateCount, setVisibleCandidateCount] = useState(CANDIDATE_PAGE_SIZE);
    const [categoryId, setCategoryId] = useState("");
    const [categoryLoading, setCategoryLoading] = useState(true);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [categoryCreating, setCategoryCreating] = useState(false);
    const categoryLoadSequenceRef = useRef(0);
    const originSearchSequenceRef = useRef(0);
    const [travelMode, setTravelMode] = useState<TravelMode>("TRANSIT");
    const [travelMinutes, setTravelMinutes] = useState(30);
    const [prepareDepartureAlert, setPrepareDepartureAlert] = useState(true);
    const [subscriptionPolicy, setSubscriptionPolicy] = useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
    const [favoriteDeparturePlaces, setFavoriteDeparturePlaces] = useState<Place[]>([]);
    const [defaultOrigin, setDefaultOrigin] = useState<Place | undefined>();
    const [originSearchQuery, setOriginSearchQuery] = useState("");
    const [originSearchResults, setOriginSearchResults] = useState<PlaceSearchItem[]>([]);
    const [originSearching, setOriginSearching] = useState(false);
    const [originSearchError, setOriginSearchError] = useState<string | null>(null);
    const defaultOriginSaveRequestIdRef = useRef(0);
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [importedCount, setImportedCount] = useState(0);
    const [alreadyImportedCount, setAlreadyImportedCount] = useState(0);
    const [preparedRouteCount, setPreparedRouteCount] = useState(0);
    const [notificationReadyCount, setNotificationReadyCount] = useState(0);
    const [failedImportCount, setFailedImportCount] = useState(0);
    const [completingCuration, setCompletingCuration] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const categories = useMemo(
        () => getWritableCalendarImportCategories(state.categories),
        [state.categories]
    );
    const selectedCategory = useMemo(
        () => resolveCalendarImportCategory(categories, categoryId),
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
    const routeCandidateCount = useMemo(
        () => selectedCandidates.filter(isCalendarRouteCandidate).length,
        [selectedCandidates]
    );
    const remainingNotificationQuota = Math.max(
        0,
        subscriptionPolicy.maxSmartSchedulesPerMonth - subscriptionPolicy.usedSmartSchedulesThisMonth
    );
    // 목적지 후보가 하나도 없으면 공통 출발지를 받아도 경로를 만들 수 없다.
    // 이 경우 사용자가 불필요한 위치 선택 단계에 갇히지 않도록 일정 저장만 진행한다.
    const routePreparationEnabled = prepareDepartureAlert &&
        routeCandidateCount > 0 &&
        remainingNotificationQuota > 0;
    const defaultOriginReady = hasFavoriteDepartureCoords(defaultOrigin);
    const canImportSelectedSchedules = !routePreparationEnabled || defaultOriginReady;
    const providerOptions = useMemo(
        () => buildCalendarProviderOptions(deviceProviderLabel),
        [deviceProviderLabel]
    );
    const calendarConsentItems = useMemo(
        () => buildCalendarConsentItems(selectedProviderIds, deviceProviderLabel),
        [deviceProviderLabel, selectedProviderIds]
    );
    const calendarConsentItemIds = useMemo(
        () => calendarConsentItems.map((item) => item.id),
        [calendarConsentItems]
    );
    const allCalendarConsentsAccepted = calendarConsentItems.every(
        (item) => !item.required || acceptedCalendarConsentIds.has(item.id)
    );
    const providerCtaLabel = selectedProviderIds.size === 0
        ? "캘린더를 선택해 주세요"
        : "선택한 캘린더로 계속";
    const permissionProviderLabel = useMemo(() => {
        const labels = [
            selectedProviderIds.has("device") ? deviceProviderLabel : null,
            selectedProviderIds.has("google") ? getCalendarProviderLabel("GOOGLE") : null,
        ].filter((label): label is string => Boolean(label));

        if (labels.length === 0) return "캘린더";
        if (labels.length === 1) return labels[0];
        return "선택한 캘린더";
    }, [deviceProviderLabel, selectedProviderIds]);
    const isManagementEntry = isCalendarImportManagementEntry({
        source,
        isCurationCompleted,
    });
    const exitWithoutImportLabel = completingCuration
        ? "처리 중"
        : isManagementEntry
            ? "변경 없이 프로필로 돌아가기"
            : "일정 없이 시작하기";
    const navigationBusy = importing || completingCuration || categoryCreating;
    const canGoBack = !navigationBusy &&
        step !== "complete" &&
        (step !== "intro" || isManagementEntry);

    usePreventRemove(categoryCreating, () => {
        Alert.alert("카테고리를 추가하고 있어요", "추가가 끝난 뒤 이전 화면으로 이동해 주세요.");
    });

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

    const loadCategories = useCallback(async () => {
        const sequence = categoryLoadSequenceRef.current + 1;
        categoryLoadSequenceRef.current = sequence;
        setCategoryLoading(true);
        setCategoryError(null);

        try {
            const nextCategories = await getScheduleCategoriesFromApi();
            if (sequence !== categoryLoadSequenceRef.current) return;

            const writableCategories = getWritableCalendarImportCategories(nextCategories);
            if (writableCategories.length === 0) {
                throw new Error("일정을 저장할 수 있는 카테고리가 없습니다.");
            }

            dispatch({ type: "SET_CATEGORIES", categories: nextCategories });
            setCategoryId((current) => (
                writableCategories.some((category) => category.id === current)
                    ? current
                    : writableCategories[0].id
            ));
        } catch {
            if (sequence !== categoryLoadSequenceRef.current) return;
            setCategoryError("카테고리를 불러오지 못했어요. 다시 확인해 주세요.");
        } finally {
            if (sequence === categoryLoadSequenceRef.current) setCategoryLoading(false);
        }
    }, [dispatch]);

    const handleCategoryCreated = useCallback((category: ScheduleCategory) => {
        dispatch({ type: "UPSERT_CATEGORY", category });
        setCategoryId(category.id);
        setCategoryError(null);
    }, [dispatch]);

    useEffect(() => {
        loadCategories().catch(() => undefined);
        return () => {
            categoryLoadSequenceRef.current += 1;
        };
    }, [loadCategories]);

    useEffect(() => () => {
        scanAttemptRef.current += 1;
        originSearchSequenceRef.current += 1;
        defaultOriginSaveRequestIdRef.current += 1;
    }, []);

    useEffect(() => {
        let cancelled = false;

        getFavoriteDeparturePlaces()
            .then((places) => {
                if (cancelled) return;
                const placesWithCoordinates = places.filter(hasFavoriteDepartureCoords);
                setFavoriteDeparturePlaces(placesWithCoordinates);
                setDefaultOrigin((current) => current ?? placesWithCoordinates[0]);
            })
            .catch(() => {
                // 신규 가입자는 저장된 출발지가 없을 수 있다. 검색 입력을 그대로 제공한다.
            });

        getMySubscriptionPolicy()
            .then((policy) => {
                if (!cancelled) setSubscriptionPolicy(policy);
            })
            .catch(() => {
                // 정책 조회 실패 시 서버의 FREE 정책보다 느슨해지지 않는 로컬 기본값을 사용한다.
                if (!cancelled) setSubscriptionPolicy(FREE_SUBSCRIPTION_POLICY);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (remainingNotificationQuota === 0) {
            setPrepareDepartureAlert(false);
        }
    }, [remainingNotificationQuota]);

    useEffect(() => {
        const availableIds = new Set(calendarConsentItemIds);

        setAcceptedCalendarConsentIds((current) => {
            const next = new Set(Array.from(current).filter((id) => availableIds.has(id)));
            return next.size === current.size ? current : next;
        });
        setExpandedCalendarConsentIds((current) => {
            const next = new Set(Array.from(current).filter((id) => availableIds.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [calendarConsentItemIds]);

    const persistCurationCompletion = async () => {
        if (isCurationCompleted) return;

        const status = await completeMemberCuration();
        if (!status.curationCompleted) {
            throw new Error("큐레이션 완료 상태를 저장하지 못했습니다.");
        }

        // 서버 저장이 끝난 뒤 로컬 인증 상태를 갱신해야 보호된 일정 화면이 열린다.
        await saveAuthCurationCompleted(true);
        const authenticated = await syncAuthentication();
        if (!authenticated) {
            throw new Error("로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.");
        }
    };

    const finishCuration = async () => {
        if (completingCuration || importing || categoryCreating) return;

        if (isManagementEntry && step !== "complete") {
            scanAttemptRef.current += 1;
            if (router.canGoBack()) router.back();
            else router.replace("/profile");
            return;
        }

        try {
            setCompletingCuration(true);
            await persistCurationCompletion();
            scanAttemptRef.current += 1;
            router.replace("/schedule");
        } catch (error) {
            Alert.alert("완료 상태 저장 실패", getErrorMessage(error, "네트워크를 확인하고 다시 시도해 주세요."));
        } finally {
            setCompletingCuration(false);
        }
    };

    const goBackStep = () => {
        if (!canGoBack) return;

        switch (step) {
            case "intro":
                if (isManagementEntry) {
                    if (router.canGoBack()) router.back();
                    else router.replace("/profile");
                }
                break;
            case "provider":
                goToStep("intro");
                break;
            case "permission":
                goToStep("provider");
                break;
            case "scanning":
                scanAttemptRef.current += 1;
                setErrorMessage("일정 확인을 중단했어요. 준비되면 다시 시도해 주세요.");
                goToStep("permission");
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
    goBackStepRef.current = goBackStep;

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            if (!shouldConsumeCalendarImportHardwareBack({
                busy: navigationBusy,
                canGoBack,
            })) return false;
            if (navigationBusy) return true;
            goBackStepRef.current();
            return true;
        });

        return () => subscription.remove();
    }, [canGoBack, navigationBusy]);

    const toggleProvider = (providerId: CalendarProviderId) => {
        setErrorMessage(null);
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

    const toggleCalendarConsent = (consentId: CalendarConsentId) => {
        setAcceptedCalendarConsentIds((current) => {
            const next = new Set(current);
            if (next.has(consentId)) {
                next.delete(consentId);
            } else {
                next.add(consentId);
            }
            return next;
        });
    };

    const toggleAllCalendarConsents = () => {
        setAcceptedCalendarConsentIds((current) => {
            if (allCalendarConsentsAccepted) {
                return new Set(
                    Array.from(current).filter((id) => !calendarConsentItemIds.includes(id))
                );
            }

            return new Set([
                ...Array.from(current),
                ...calendarConsentItems.filter((item) => item.required).map((item) => item.id),
            ]);
        });
    };

    const toggleCalendarConsentDetail = (consentId: CalendarConsentId) => {
        setExpandedCalendarConsentIds((current) => {
            const next = new Set(current);
            if (next.has(consentId)) {
                next.delete(consentId);
            } else {
                next.add(consentId);
            }
            return next;
        });
    };

    const scanCalendars = async () => {
        const attemptId = scanAttemptRef.current + 1;
        scanAttemptRef.current = attemptId;
        const isCurrentAttempt = () => scanAttemptRef.current === attemptId;

        setErrorMessage(null);
        goToStep("scanning");
        setScanStage(0);
        setScanStatusMessage("캘린더 연결 상태를 확인하고 있어요");

        try {
            const outcome = await scanSelectedCalendarProviders({
                selectedProviderIds,
                deviceProvider: getDeviceCalendarProvider(),
                deviceProviderLabel,
                requestDevicePermission: requestDeviceCalendarPermission,
                loadDeviceSummary: loadDeviceCalendarImportSummary,
                requestGoogleAccessToken: requestGoogleCalendarAccessToken,
                loadGoogleSummary: loadGoogleCalendarImportSummary,
                shouldContinue: isCurrentAttempt,
                onProgress: (progress) => {
                    if (!isCurrentAttempt()) return;
                    const presentation = getScanProgressPresentation(progress, deviceProviderLabel);
                    setScanStage((current) => Math.max(current, presentation.stage));
                    setScanStatusMessage(presentation.message);
                },
            });

            if (outcome.cancelled || !isCurrentAttempt()) return;

            if (outcome.scans.length === 0) {
                setErrorMessage(
                    outcome.failures.length > 0
                        ? formatCalendarScanFailures(outcome.failures)
                        : "연결된 캘린더에서 일정을 불러오지 못했습니다."
                );
                goToStep("permission");
                return;
            }

            const loadedCandidates = mergeCalendarCandidates(
                outcome.scans.flatMap((scan) => scan.summary.candidates)
            );
            setScanStage(2);
            setScanStatusMessage("가져올 일정 후보를 정리하고 있어요");

            try {
                await withCalendarImportTimeout(
                    recordCalendarScan({
                        provider: outcome.scans[0].provider,
                        providerLabel: outcome.scans.map((scan) => scan.providerLabel).join(" + "),
                        providerLabels: outcome.scans.map((scan) => scan.providerLabel),
                        calendarCount: outcome.scans.reduce(
                            (total, scan) => total + scan.summary.calendarCount,
                            0
                        ),
                        calendarNames: outcome.scans.flatMap((scan) =>
                            scan.summary.calendarSources.map((calendar) => calendar.title)
                        ),
                        eventCandidateCount: loadedCandidates.length,
                    }),
                    {
                        timeoutMs: SECURE_STORAGE_TIMEOUT_MS,
                        operationName: "캘린더 연결 상태 저장",
                    }
                );
            } catch (error) {
                console.warn("[calendar-import] connection snapshot save delayed", error);
            }

            if (!isCurrentAttempt()) return;

            setErrorMessage(
                outcome.failures.length > 0
                    ? `일부 캘린더는 연결하지 못했어요.\n${formatCalendarScanFailures(outcome.failures)}`
                    : null
            );
            setCandidates(loadedCandidates);
            setSelectedIds(getDefaultSelectedCandidateIds(loadedCandidates));
            setVisibleCandidateCount(CANDIDATE_PAGE_SIZE);
            goToStep("select");
        } catch (error) {
            if (!isCurrentAttempt()) return;
            setErrorMessage(getErrorMessage(error, "캘린더 일정을 불러오지 못했습니다."));
            goToStep("permission");
        }
    };

    const requestGoogleCalendarAccessToken = async (): Promise<string | null> => {
        if (!GOOGLE_CALENDAR_CLIENT_ID) {
            throw new Error("Google Calendar 연결을 지금 사용할 수 없어요. 기기 캘린더를 선택하거나 잠시 후 다시 시도해 주세요.");
        }

        if (!googleAuthRequest) {
            throw new Error("Google Calendar 연결 준비가 아직 끝나지 않았어요. 잠시 후 다시 시도해 주세요.");
        }

        const result = await withCalendarImportTimeout(
            promptGoogleCalendarAuth(),
            {
                timeoutMs: GOOGLE_AUTH_TIMEOUT_MS,
                operationName: "Google 계정 연결",
            }
        );
        if (result.type === "error") {
            throw new Error(
                result.error?.message ||
                result.params?.error_description ||
                "Google 계정 연결에 실패했어요."
            );
        }
        if (result.type !== "success") return null;

        if (result.authentication?.accessToken) {
            await withCalendarImportTimeout(
                saveGoogleCalendarAccessToken({
                    accessToken: result.authentication.accessToken,
                    expiresIn: result.authentication.expiresIn,
                }),
                {
                    timeoutMs: SECURE_STORAGE_TIMEOUT_MS,
                    operationName: "Google 연결 정보 저장",
                }
            );
            return result.authentication.accessToken;
        }

        const code = result.params.code;
        if (!code || !googleAuthRequest.codeVerifier) {
            throw new Error("Google Calendar 인증 코드를 확인하지 못했습니다.");
        }

        const tokenResponse = await withCalendarImportTimeout(
            AuthSession.exchangeCodeAsync(
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
            ),
            {
                timeoutMs: GOOGLE_TOKEN_EXCHANGE_TIMEOUT_MS,
                operationName: "Google 인증 완료",
            }
        );

        await withCalendarImportTimeout(
            saveGoogleCalendarAccessToken({
                accessToken: tokenResponse.accessToken,
                expiresIn: tokenResponse.expiresIn,
            }),
            {
                timeoutMs: SECURE_STORAGE_TIMEOUT_MS,
                operationName: "Google 연결 정보 저장",
            }
        );
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

    const searchDefaultOrigin = async () => {
        const query = originSearchQuery.trim();
        if (!query || originSearching) return;
        const sequence = originSearchSequenceRef.current + 1;
        originSearchSequenceRef.current = sequence;

        try {
            setOriginSearching(true);
            setOriginSearchError(null);
            const results = await withCalendarImportTimeout(
                searchAddressByKeyword(query),
                {
                    timeoutMs: PLACE_SEARCH_TIMEOUT_MS,
                    operationName: "주 출발지 검색",
                }
            );
            if (sequence !== originSearchSequenceRef.current) return;
            setOriginSearchResults(results.slice(0, 5));
            if (results.length === 0) {
                setOriginSearchError("검색 결과가 없어요. 건물명이나 도로명 주소로 다시 검색해 주세요.");
            }
        } catch (error) {
            if (sequence !== originSearchSequenceRef.current) return;
            setOriginSearchResults([]);
            setOriginSearchError(getErrorMessage(error, "출발지를 검색하지 못했습니다."));
        } finally {
            if (sequence === originSearchSequenceRef.current) setOriginSearching(false);
        }
    };

    const changeOriginSearchQuery = (value: string) => {
        originSearchSequenceRef.current += 1;
        setOriginSearchQuery(value);
        setOriginSearching(false);
        setOriginSearchResults([]);
        setOriginSearchError(null);
    };

    const selectDefaultOrigin = (place: Place) => {
        if (!hasFavoriteDepartureCoords(place)) return;

        Keyboard.dismiss();
        const requestId = defaultOriginSaveRequestIdRef.current + 1;
        defaultOriginSaveRequestIdRef.current = requestId;
        setDefaultOrigin(place);
        setOriginSearchQuery(place.name?.trim() || place.address?.trim() || "");
        setOriginSearchResults([]);
        setOriginSearchError(null);
        setFavoriteDeparturePlaces((current) => [
            place,
            ...current.filter((item) => !isSamePlace(item, place)),
        ].slice(0, 5));

        saveFavoriteDeparturePlace(place)
            .then((saved) => {
                if (requestId !== defaultOriginSaveRequestIdRef.current || !saved) return;
                setDefaultOrigin(saved);
                setFavoriteDeparturePlaces((current) => [
                    saved,
                    ...current.filter((item) => !isSamePlace(item, saved)),
                ].slice(0, 5));
                setOriginSearchError(null);
            })
            .catch((error) => {
                if (requestId !== defaultOriginSaveRequestIdRef.current) return;
                // 현재 가져오기는 메모리의 선택값으로 진행할 수 있지만 계정 동기화 실패는 숨기지 않는다.
                setOriginSearchError("기본 출발지를 계정에 저장하지 못했어요. 네트워크를 확인해 주세요.");
                console.warn("[calendar-import] default origin save failed", error);
            });
    };

    const importSelectedSchedules = async () => {
        const importCategory = selectedCategory;
        if (
            selectedCandidates.length === 0 ||
            importing ||
            categoryCreating ||
            !canImportSelectedSchedules ||
            !importCategory
        ) return;

        try {
            setImporting(true);
            setImportProgress(0);
            setAlreadyImportedCount(0);
            setPreparedRouteCount(0);
            setNotificationReadyCount(0);
            setFailedImportCount(0);

            let successCount = 0;
            let skippedCount = 0;
            let routeCount = 0;
            let enabledNotificationCount = 0;
            let failureCount = 0;
            let processedCount = 0;
            let lastError: unknown;
            const settings = {
                category: importCategory,
                travelMode,
                travelMinutes,
                prepareDepartureAlert: routePreparationEnabled,
            };
            const placeCache = new Map<string, Promise<Place | undefined>>();
            const resolvePlace = (query: string, center?: RoutePathCoord): Promise<Place | undefined> => {
                const key = buildPlaceSearchCacheKey(query, center);
                const cached = placeCache.get(key);
                if (cached) return cached;

                const request = withCalendarImportTimeout(
                    searchAddressByKeyword(query, center ? { center, radiusKm: 100 } : undefined),
                    {
                        timeoutMs: PLACE_SEARCH_TIMEOUT_MS,
                        operationName: `장소 검색 (${query})`,
                    }
                ).then((results) => results[0]);
                placeCache.set(key, request);
                return request;
            };
            const findRoutes = (
                origin: Place,
                destination: Place,
                routeSettings: typeof settings,
                departureAt: Date
            ) => withCalendarImportTimeout(
                getRouteAlternativeOptions(
                    origin,
                    destination,
                    routeSettings.travelMode,
                    { departureAt, searchFutureService: true }
                ),
                {
                    timeoutMs: ROUTE_SEARCH_TIMEOUT_MS,
                    operationName: "캘린더 일정 경로 생성",
                }
            );

            // 장소·경로 공급자 요청은 세 개씩만 병렬 처리한다. 20개 일정을 한꺼번에 조회해
            // rate limit에 걸리는 것을 막으면서도 일정 하나씩 기다리는 지연은 줄인다.
            for (let offset = 0; offset < selectedCandidates.length; offset += IMPORT_BATCH_SIZE) {
                const batch = selectedCandidates.slice(offset, offset + IMPORT_BATCH_SIZE);
                const canAttemptMoreNotifications = routePreparationEnabled &&
                    defaultOriginReady &&
                    enabledNotificationCount < remainingNotificationQuota;
                const enrichedBatch = await Promise.all(batch.map(async (candidate) => {
                    const enrichment = canAttemptMoreNotifications
                        ? await enrichCalendarCandidateWithRoute(
                            candidate,
                            settings,
                            defaultOrigin,
                            { resolvePlace, findRoutes }
                        )
                        : {
                            payload: buildSchedulePayloadFromCandidate(candidate, settings),
                            routePrepared: false,
                            hints: extractCalendarRouteHints(candidate),
                        };

                    return { candidate, ...enrichment };
                }));

                // 일정 생성은 순차 처리해 구독 quota가 동시에 중복 소비되지 않게 한다.
                for (const enriched of enrichedBatch) {
                    const shouldEnableNotification = enriched.routePrepared &&
                        enabledNotificationCount < remainingNotificationQuota;
                    const payload = shouldEnableNotification
                        ? enableCalendarImportNotification(
                            enriched.payload,
                            subscriptionPolicy.minEtaRefreshIntervalMinutes
                        )
                        : enriched.payload;

                    try {
                        const result = await createImportedSchedule(enriched.candidate, payload);
                        dispatch({ type: "ADD_ITEM", item: result.item });
                        if (result.created) {
                            successCount += 1;
                            if (enriched.routePrepared) routeCount += 1;
                            if (result.notificationEnabled) enabledNotificationCount += 1;
                        } else {
                            skippedCount += 1;
                        }
                    } catch (error) {
                        lastError = error;
                        failureCount += 1;
                    } finally {
                        processedCount += 1;
                        setImportProgress(processedCount);
                    }
                }
            }

            if (successCount === 0 && skippedCount === 0) {
                throw lastError ?? new Error("선택한 일정을 가져오지 못했습니다.");
            }

            setImportedCount(successCount);
            setAlreadyImportedCount(skippedCount);
            setPreparedRouteCount(routeCount);
            setNotificationReadyCount(enabledNotificationCount);
            setFailedImportCount(failureCount);
            try {
                await recordCalendarImportCompleted(successCount);
            } catch (error) {
                // 연결 이력 저장이 실패해도 이미 생성된 일정을 다시 보내 중복시키지 않는다.
                console.warn("[calendar-import] completion snapshot save failed", error);
            }
            try {
                await persistCurationCompletion();
            } catch (error) {
                // 일정 생성은 이미 끝났으므로 중복 가져오기를 유도하지 않는다. 완료 화면의
                // "내 일정 보기" 버튼이 멱등 완료 API를 다시 호출해 안전하게 복구한다.
                console.warn("[calendar-import] account completion save failed", error);
            }
            goToStep("complete");
        } catch (error) {
            Alert.alert("가져오기 실패", getErrorMessage(error, "선택한 일정을 가져오지 못했습니다."));
        } finally {
            setImporting(false);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.root, { paddingTop: insets.top + 12 }]}
        >
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={styles.topRow}>
                <Pressable
                    disabled={!canGoBack}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="이전 단계로 돌아가기"
                    accessibilityState={{ disabled: !canGoBack }}
                    accessibilityElementsHidden={!canGoBack}
                    importantForAccessibility={canGoBack ? "auto" : "no-hide-descendants"}
                    onPress={goBackStep}
                    style={({ pressed }) => [
                        styles.backButton,
                        !canGoBack && styles.backButtonHidden,
                        pressed && canGoBack && styles.pressed,
                    ]}
                >
                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                </Pressable>
                <CurationProgress step={step} />
            </View>

            <ScrollView
                ref={scrollViewRef}
                style={styles.scroll}
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                keyboardShouldPersistTaps="handled"
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
                            가져올 일정만 고르면 출발 준비까지 이어서 설정할 수 있어요.
                        </Text>

                        <View style={styles.introPointList}>
                            <IntroPoint label="원본 캘린더는 그대로 유지해요" />
                            <IntroPoint label="필요한 일정만 직접 선택해요" />
                        </View>
                    </View>
                )}

                {step === "provider" && (
                    <View style={styles.stepWrap}>
                        <Text style={styles.eyebrow}>캘린더 가져오기</Text>
                        <Text style={styles.title}>어느 캘린더에서{"\n"}가져올까요?</Text>
                        <Text style={styles.subtitle}>
                            가져올 캘린더를 모두 선택해 주세요.
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
                        <Text style={styles.title}>{permissionProviderLabel}의{"\n"}일정을 확인할게요</Text>
                        <Text style={styles.subtitle}>
                            일정을 읽기 전에 필요한 항목만 확인해 주세요.
                        </Text>
                        <CalendarConsentChecklist
                            items={calendarConsentItems}
                            acceptedIds={acceptedCalendarConsentIds}
                            expandedIds={expandedCalendarConsentIds}
                            allAccepted={allCalendarConsentsAccepted}
                            onToggleAll={toggleAllCalendarConsents}
                            onToggleItem={toggleCalendarConsent}
                            onToggleDetail={toggleCalendarConsentDetail}
                        />
                        {errorMessage ? (
                            <View accessibilityLiveRegion="polite" style={styles.inlineNotice}>
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
                        <Text style={styles.title}>가져올 일정을{"\n"}찾고 있어요</Text>
                        <Text style={styles.subtitle}>{scanStatusMessage}</Text>
                        <View style={styles.scanList}>
                            {SCAN_MESSAGES.map((message, index) => (
                                <View key={message} style={styles.scanRow}>
                                    <Ionicons
                                        name={scanStage > index
                                            ? "checkmark-circle"
                                            : scanStage === index
                                                ? "time-outline"
                                                : "ellipse-outline"}
                                        size={19}
                                        color={scanStage >= index ? BRAND_BLUE : colors.textDisabled}
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
                        <Text pointerEvents="none" style={styles.eyebrow}>{candidates.length}개 일정 찾음</Text>
                        <Text pointerEvents="none" style={styles.title}>
                            {selectedIds.size > 0
                                ? `일정 ${selectedIds.size}개를\n선택했어요`
                                : "가져올 일정을\n선택해 주세요"}
                        </Text>
                        <Text pointerEvents="none" style={styles.subtitle}>
                            추천 일정은 미리 선택했어요. 필요 없는 일정은 해제할 수 있어요.
                        </Text>
                        {errorMessage ? (
                            <View accessibilityLiveRegion="polite" style={styles.inlineNotice}>
                                <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                                <Text style={styles.inlineNoticeText}>{errorMessage}</Text>
                            </View>
                        ) : null}

                        {candidates.length === 0 ? (
                            <View style={styles.emptyBox}>
                                <Ionicons name="calendar-clear-outline" size={34} color={colors.textDisabled} />
                                <Text style={styles.emptyTitle}>가져올 일정이 없어요</Text>
                                <Text style={styles.emptyText}>일정 화면에서 직접 첫 일정을 만들 수 있어요.</Text>
                            </View>
                        ) : (
                            <>
                                <View style={styles.selectionControlList}>
                                    <SelectionControlRow
                                        title={allCandidatesSelected ? "전체 선택됨" : "전체 선택"}
                                        description={`${candidates.length}개 일정을 한 번에 선택해요`}
                                        icon="checkmark-done-outline"
                                        active={allCandidatesSelected}
                                        onPress={selectAllCandidates}
                                    />
                                    <SelectionControlRow
                                        title="전체 해제"
                                        description="필요한 일정만 다시 골라요"
                                        icon="remove-circle-outline"
                                        active={selectedIds.size === 0}
                                        onPress={clearSelectedCandidates}
                                    />
                                </View>

                                {candidateSourceGroups.length > 1 ? (
                                    <>
                                        <SectionTitle label="캘린더별 선택" />
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
                                    {candidates.slice(0, visibleCandidateCount).map((candidate) => (
                                        <CandidateRow
                                            key={candidate.id}
                                            candidate={candidate}
                                            selected={selectedIds.has(candidate.id)}
                                            onPress={() => toggleCandidate(candidate)}
                                        />
                                    ))}
                                </View>
                                {visibleCandidateCount < candidates.length ? (
                                    <GhostButton
                                        label={`일정 더 보기 (${candidates.length - visibleCandidateCount}개 남음)`}
                                        onPress={() => setVisibleCandidateCount((count) => Math.min(count + CANDIDATE_PAGE_SIZE, candidates.length))}
                                    />
                                ) : null}
                            </>
                        )}
                    </View>
                )}

                {step === "enrich" && (
                    <View style={styles.stepWrap}>
                        <Text style={styles.eyebrow}>출발 준비 설정</Text>
                        <Text style={styles.title}>가져오기 전에{"\n"}출발 준비를 설정해요</Text>
                        <Text style={styles.subtitle}>
                            {routeCandidateCount > 0
                                ? `${selectedCandidates.length}개 일정 중 ${routeCandidateCount}개는 경로와 알림도 준비할 수 있어요.`
                                : "선택한 일정은 경로 없이도 바로 가져올 수 있어요."}
                        </Text>

                        <SectionTitle label="카테고리 선택" />
                        {categoryLoading && categories.length === 0 ? (
                            <View
                                accessibilityLiveRegion="polite"
                                style={styles.categoryStatus}
                            >
                                <ActivityIndicator size="small" color={colors.textSecondary} />
                                <Text style={styles.categoryStatusText}>카테고리를 불러오는 중이에요</Text>
                            </View>
                        ) : categories.length > 0 ? (
                            <>
                                <View style={styles.chipRow}>
                                    {categories.map((category) => (
                                        <OptionChip
                                            key={category.id}
                                            label={category.title}
                                            active={category.id === selectedCategory?.id}
                                            color={category.color}
                                            onPress={() => setCategoryId(category.id)}
                                        />
                                    ))}
                                </View>
                                {categoryError ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="카테고리 목록 다시 불러오기"
                                        accessibilityState={{ busy: categoryLoading, disabled: categoryCreating }}
                                        disabled={categoryLoading || categoryCreating}
                                        onPress={() => loadCategories().catch(() => undefined)}
                                        style={({ pressed }) => [
                                            styles.categoryStatus,
                                            (pressed || categoryLoading || categoryCreating) && styles.pressed,
                                        ]}
                                    >
                                        <Ionicons name="refresh-outline" size={17} color={colors.textSecondary} />
                                        <Text style={styles.categoryStatusText}>
                                            최신 목록을 확인하지 못했어요 · 다시 시도
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="카테고리 다시 불러오기"
                                accessibilityState={{ busy: categoryLoading, disabled: categoryCreating }}
                                disabled={categoryLoading || categoryCreating}
                                onPress={() => loadCategories().catch(() => undefined)}
                                style={({ pressed }) => [
                                    styles.categoryStatus,
                                    styles.categoryStatusError,
                                    (pressed || categoryLoading || categoryCreating) && styles.pressed,
                                ]}
                            >
                                <Ionicons name="alert-circle-outline" size={18} color={colors.textSecondary} />
                                <View style={styles.categoryStatusCopy}>
                                    <Text style={styles.categoryStatusTitle}>{categoryError}</Text>
                                    <Text style={styles.categoryStatusText}>탭해서 다시 시도</Text>
                                </View>
                            </Pressable>
                        )}

                        <CalendarImportCategoryCreator
                            categoryCount={categories.length}
                            disabled={categoryLoading || importing || completingCuration}
                            onBusyChange={setCategoryCreating}
                            onCreated={handleCategoryCreated}
                        />

                        <View style={styles.switchRow}>
                            <View style={styles.switchTextWrap}>
                                <Text style={styles.switchTitle}>경로와 출발 알림 준비</Text>
                                <Text style={styles.switchHint}>
                                    {routeCandidateCount === 0
                                        ? "경로 후보가 없어 일정만 가져와요"
                                        : remainingNotificationQuota > 0
                                            ? `이번 달 최대 ${remainingNotificationQuota}개 자동 설정`
                                            : "이번 달 실시간 알림 한도를 모두 사용했어요"}
                                </Text>
                            </View>
                            <Switch
                                accessibilityLabel="경로와 출발 알림 준비"
                                value={routePreparationEnabled}
                                onValueChange={setPrepareDepartureAlert}
                                disabled={routeCandidateCount === 0 || remainingNotificationQuota === 0}
                                trackColor={{
                                    false: mode === "dark" ? "#34363D" : "#D7D9DF",
                                    true: BRAND_BLUE,
                                }}
                                thumbColor="#FFFFFF"
                            />
                        </View>

                        {routePreparationEnabled ? (
                            <>
                                <SectionTitle label="기본 출발지" />
                                <DefaultOriginPicker
                                    favorites={favoriteDeparturePlaces}
                                    selected={defaultOrigin}
                                    query={originSearchQuery}
                                    results={originSearchResults}
                                    searching={originSearching}
                                    error={originSearchError}
                                    onQueryChange={changeOriginSearchQuery}
                                    onSearch={searchDefaultOrigin}
                                    onSelect={selectDefaultOrigin}
                                />

                                <View style={styles.routePreparationNotice}>
                                    <Ionicons name="sparkles-outline" size={17} color={BRAND_BLUE} />
                                    <Text style={styles.routePreparationNoticeText}>
                                        일정 메모에 출발지가 있으면 우선 사용하고, 없으면 기본 출발지에서 경로를 만들어요.
                                    </Text>
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

                                <SectionTitle label="경로가 없을 때 예상 이동시간" />
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
                            </>
                        ) : null}
                    </View>
                )}

                {step === "complete" && (
                    <View style={styles.stepWrap}>
                        <View
                            accessible
                            accessibilityLabel="NoLate"
                            accessibilityRole="image"
                            style={styles.completeLogoWrap}
                        >
                            <Image source={APP_LOGO} resizeMode="cover" style={styles.introLogoImage} />
                        </View>
                        <Text style={styles.title}>
                            {importedCount > 0
                                ? `${importedCount}개 일정을\nNoLate로 가져왔어요`
                                : "선택한 일정은\n이미 NoLate에 있어요"}
                        </Text>
                        <Text style={styles.subtitle}>
                            {importedCount === 0
                                ? "중복으로 저장하지 않고 기존 일정을 그대로 유지했어요."
                                : notificationReadyCount > 0
                                ? `${notificationReadyCount}개 일정은 경로와 출발 알림까지 준비했어요.`
                                : preparedRouteCount > 0
                                    ? `${preparedRouteCount}개 일정의 경로를 준비했어요.`
                                    : routePreparationEnabled
                                        ? "가져오기는 완료했고, 경로가 없는 일정은 알림을 꺼 두었어요."
                                        : "선택한 일정을 NoLate 캘린더에 저장했어요."}
                            {alreadyImportedCount > 0 && importedCount > 0
                                ? `\n이미 가져온 ${alreadyImportedCount}개 일정은 건너뛰었어요.`
                                : ""}
                            {failedImportCount > 0 ? `\n${failedImportCount}개 일정은 저장하지 못했어요.` : ""}
                        </Text>
                    </View>
                )}
                </Animated.View>
            </ScrollView>

            <Animated.View
                style={[
                    styles.footer,
                    // KeyboardAvoidingView의 iOS padding이 루트 paddingBottom을 덮어쓰므로
                    // 실제 버튼을 담는 푸터에서 기기별 하단 안전 영역을 직접 보장한다.
                    { paddingBottom: Math.max(insets.bottom, 18) + (step === "complete" ? 8 : 0) },
                    footerMotionStyle,
                ]}
            >
                {step === "intro" && (
                    <>
                        <PrimaryButton label="캘린더 선택하기" onPress={() => goToStep("provider")} />
                        <GhostButton
                            label={exitWithoutImportLabel}
                            disabled={completingCuration}
                            onPress={finishCuration}
                        />
                    </>
                )}
                {step === "provider" && (
                    <>
                        <PrimaryButton
                            label={providerCtaLabel}
                            disabled={selectedProviderIds.size === 0}
                            onPress={() => goToStep("permission")}
                        />
                        <GhostButton
                            label={exitWithoutImportLabel}
                            disabled={completingCuration}
                            onPress={finishCuration}
                        />
                    </>
                )}
                {step === "permission" && (
                    <>
                        <PrimaryButton
                            label={allCalendarConsentsAccepted ? "동의하고 일정 확인하기" : "필수 항목을 확인해 주세요"}
                            disabled={!allCalendarConsentsAccepted}
                            onPress={scanCalendars}
                        />
                        <GhostButton
                            label={exitWithoutImportLabel}
                            disabled={completingCuration}
                            onPress={finishCuration}
                        />
                    </>
                )}
                {step === "scanning" && (
                    <GhostButton label="이전으로 돌아가기" onPress={goBackStep} />
                )}
                {step === "select" && (
                    <>
                        {candidates.length === 0 ? (
                            <PrimaryButton
                                label={exitWithoutImportLabel}
                                disabled={completingCuration}
                                onPress={finishCuration}
                            />
                        ) : (
                            <PrimaryButton
                                label={selectedIds.size > 0 ? `일정 ${selectedIds.size}개 계속하기` : "가져올 일정을 선택해 주세요"}
                                disabled={selectedIds.size === 0}
                                onPress={() => goToStep("enrich")}
                            />
                        )}
                        <GhostButton label={candidates.length === 0 ? "캘린더 다시 선택" : "이전"} onPress={goBackStep} />
                    </>
                )}
                {step === "enrich" && (
                    <>
                        <PrimaryButton
                            label={categoryCreating
                                ? "카테고리를 추가하는 중"
                                : importing
                                    ? `${importProgress}/${selectedCandidates.length} 가져오는 중`
                                    : categoryLoading && !selectedCategory
                                        ? "카테고리를 불러오는 중"
                                        : !selectedCategory
                                            ? "카테고리를 다시 불러와 주세요"
                                            : routePreparationEnabled && !defaultOriginReady
                                                ? "기본 출발지를 선택해 주세요"
                                                : `일정 ${selectedCandidates.length}개 가져오기`}
                            disabled={categoryCreating || importing || !canImportSelectedSchedules || !selectedCategory}
                            onPress={importSelectedSchedules}
                        />
                        <GhostButton
                            label="이전"
                            disabled={categoryCreating || importing}
                            onPress={() => goToStep("select")}
                        />
                    </>
                )}
                {step === "complete" && (
                    <PrimaryButton
                        label={completingCuration ? "완료 상태 저장 중" : "내 일정 보기"}
                        disabled={completingCuration}
                        onPress={finishCuration}
                    />
                )}
            </Animated.View>
        </KeyboardAvoidingView>
    );
}

async function createImportedSchedule(
    candidate: DeviceCalendarCandidate,
    payload: SchedulePayload
): Promise<{
    item: Awaited<ReturnType<typeof importCalendarSchedule>>["item"];
    created: boolean;
    notificationEnabled: boolean;
}> {
    const source = buildCalendarImportSource(candidate);
    try {
        const result = await importCalendarSchedule(payload, source);
        return {
            ...result,
            notificationEnabled: result.created && payload.notificationEnabled === true,
        };
    } catch (error) {
        if (payload.notificationEnabled !== true || !isNotificationConfigurationError(error)) {
            throw error;
        }

        // 구독 잔여량이 다른 기기에서 먼저 소비됐거나 서버 정책이 바뀐 경우에도
        // 일정 자체는 잃지 않도록 같은 payload를 알림만 끈 상태로 한 번 저장한다.
        const result = await importCalendarSchedule({
            ...payload,
            notificationEnabled: false,
            notificationLeadMinutes: undefined,
            notificationIntervalMinutes: undefined,
        }, source);
        return { ...result, notificationEnabled: false };
    }
}

function isNotificationConfigurationError(error: unknown): boolean {
    const message = getErrorMessage(error, "");
    return /(실시간 출발 알림|출발 알림|알림 일정|요금제|subscription)/i.test(message);
}

function buildPlaceSearchCacheKey(query: string, center?: RoutePathCoord): string {
    return [
        query.trim().toLocaleLowerCase(),
        center ? center.lat.toFixed(4) : "",
        center ? center.lng.toFixed(4) : "",
    ].join(":");
}

function isSamePlace(a: Place, b: Place): boolean {
    if (
        typeof a.lat === "number" && typeof a.lng === "number" &&
        typeof b.lat === "number" && typeof b.lng === "number"
    ) {
        return Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001;
    }
    return `${a.name ?? ""}:${a.address ?? ""}`.trim().toLocaleLowerCase() ===
        `${b.name ?? ""}:${b.address ?? ""}`.trim().toLocaleLowerCase();
}

function isCalendarRouteCandidate(candidate: DeviceCalendarCandidate): boolean {
    const startAt = new Date(candidate.startAt);
    return !candidate.allDay &&
        Number.isFinite(startAt.getTime()) &&
        startAt.getTime() > Date.now() &&
        Boolean(extractCalendarRouteHints(candidate).destinationQuery);
}

function CalendarConsentChecklist({
    items,
    acceptedIds,
    expandedIds,
    allAccepted,
    onToggleAll,
    onToggleItem,
    onToggleDetail,
}: {
    items: CalendarConsentItem[];
    acceptedIds: Set<CalendarConsentId>;
    expandedIds: Set<CalendarConsentId>;
    allAccepted: boolean;
    onToggleAll: () => void;
    onToggleItem: (id: CalendarConsentId) => void;
    onToggleDetail: (id: CalendarConsentId) => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={styles.consentCard}>
            <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allAccepted }}
                accessibilityLabel="필수 캘린더 연동 항목 모두 동의"
                onPress={onToggleAll}
                style={({ pressed }) => [
                    styles.consentAllRow,
                    pressed && styles.pressed,
                ]}
            >
                <ConsentCheck checked={allAccepted} />
                <View style={styles.consentCopy}>
                    <Text style={styles.consentAllTitle}>필수 항목에 모두 동의해요</Text>
                    <Text style={styles.consentDescription}>
                        원본은 바꾸지 않고, 선택한 일정만 NoLate에 저장해요.
                    </Text>
                </View>
            </Pressable>

            <View style={styles.consentItemList}>
                {items.map((item) => {
                    const checked = acceptedIds.has(item.id);
                    const expanded = expandedIds.has(item.id);

                    return (
                        <View key={item.id} style={styles.consentItem}>
                            <View style={styles.consentItemHeader}>
                                <Pressable
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked }}
                                    accessibilityLabel={`${item.title} ${item.required ? "필수" : "선택"} 동의`}
                                    onPress={() => onToggleItem(item.id)}
                                    style={({ pressed }) => [
                                        styles.consentItemToggle,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <ConsentCheck checked={checked} compact />
                                    <View style={styles.consentCopy}>
                                        <View style={styles.consentTitleRow}>
                                            <Text numberOfLines={1} style={styles.consentItemTitle}>
                                                {item.title}
                                            </Text>
                                            {item.required ? (
                                                <Text style={styles.consentRequired}>(필수)</Text>
                                            ) : null}
                                        </View>
                                        <Text numberOfLines={2} style={styles.consentDescription}>
                                            {item.summary}
                                        </Text>
                                    </View>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded }}
                                    accessibilityLabel={`${item.title} 상세 ${expanded ? "접기" : "보기"}`}
                                    hitSlop={8}
                                    onPress={() => onToggleDetail(item.id)}
                                    style={({ pressed }) => [
                                        styles.consentChevron,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name={expanded ? "chevron-up" : "chevron-down"}
                                        size={17}
                                        color={colors.textSecondary}
                                    />
                                </Pressable>
                            </View>

                            {expanded ? (
                                <View style={styles.consentDetailList}>
                                    {item.detail.map((line) => (
                                        <View key={line} style={styles.consentDetailRow}>
                                            <Text style={styles.consentDetailBullet}>-</Text>
                                            <Text style={styles.consentDetailText}>{line}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

function ConsentCheck({ checked, compact }: { checked: boolean; compact?: boolean }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={[
            compact ? styles.consentCheckCompact : styles.consentCheck,
            checked && styles.consentCheckSelected,
        ]}>
            {checked ? (
                <Ionicons
                    name="checkmark"
                    size={compact ? 13 : 15}
                    color="#FFFFFF"
                />
            ) : null}
        </View>
    );
}

function CurationProgress({ step }: { step: OnboardingStep }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);
    const current = curationProgressValue(step);

    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="캘린더 가져오기 진행 상황"
            accessibilityValue={{
                min: 1,
                max: CURATION_PROGRESS_SEGMENT_COUNT,
                now: current,
                text: `${current}/${CURATION_PROGRESS_SEGMENT_COUNT}단계`,
            }}
            style={styles.curationProgress}
        >
            {Array.from({ length: CURATION_PROGRESS_SEGMENT_COUNT }, (_, index) => (
                <View
                    key={index}
                    style={[
                        styles.curationProgressSegment,
                        index < current && styles.curationProgressSegmentActive,
                    ]}
                />
            ))}
        </View>
    );
}

function StepIcon({ name }: { name: ComponentProps<typeof Ionicons>["name"] }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={styles.stepIcon}>
            <Ionicons name={name} size={28} color={BRAND_BLUE} />
        </View>
    );
}

function curationProgressValue(step: OnboardingStep): number {
    switch (step) {
        case "intro":
            return 1;
        case "provider":
            return 2;
        case "permission":
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

function IntroPoint({ label }: { label: string }) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={styles.introPoint}>
            <Ionicons name="checkmark-circle" size={18} color={BRAND_BLUE} />
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
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled: !provider.available }}
            accessibilityLabel={`${provider.title}, ${provider.description}`}
            disabled={!provider.available}
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
                {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
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
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}, ${description}`}
            accessibilityState={{ selected: active }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.selectionControlRow,
                active && styles.selectionControlRowActive,
                pressed && styles.pressed,
            ]}
        >
            <View style={[styles.selectionControlIcon, active && styles.selectionControlIconActive]}>
                <Ionicons
                    name={icon}
                    size={16}
                    color={active ? "#FFFFFF" : colors.textPrimary}
                />
            </View>
            <View style={styles.selectionControlCopy}>
                <Text style={styles.selectionControlTitle}>{title}</Text>
                <Text style={styles.selectionControlDescription}>{description}</Text>
            </View>
        </Pressable>
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
        <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`${group.title}, ${group.selectedCount}/${group.totalCount}개 선택`}
            accessibilityState={{
                checked: active
                    ? true
                    : group.selectedCount > 0
                        ? "mixed"
                        : false,
            }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.sourceGroupButton,
                active && styles.sourceGroupButtonActive,
                pressed && styles.pressed,
            ]}
        >
            <View style={[styles.checkCircle, active && styles.checkCircleSelected]}>
                {active ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
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
        </Pressable>
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
            accessibilityRole="checkbox"
            accessibilityLabel={`${candidate.title}, ${formatCandidateDate(candidate)}${candidate.locationName ? `, ${candidate.locationName}` : ""}`}
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.candidateRow,
                candidate.requiresTimeReview && styles.candidateRowReview,
                selected && styles.candidateRowSelected,
                pressed && styles.pressed,
            ]}
        >
            <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
                {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
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
                        {candidate.requiresTimeReview ? "시간 확인이 필요한 종일 일정" : candidate.calendarTitle}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

function DefaultOriginPicker({
    favorites,
    selected,
    query,
    results,
    searching,
    error,
    onQueryChange,
    onSearch,
    onSelect,
}: {
    favorites: Place[];
    selected?: Place;
    query: string;
    results: PlaceSearchItem[];
    searching: boolean;
    error: string | null;
    onQueryChange: (value: string) => void;
    onSearch: () => void;
    onSelect: (place: Place) => void;
}) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <View style={styles.defaultOriginWrap}>
            {favorites.length > 0 ? (
                <View style={styles.chipRow}>
                    {favorites.slice(0, 5).map((place) => (
                        <OptionChip
                            key={`${place.lat}:${place.lng}:${place.name ?? place.address ?? "place"}`}
                            label={place.name?.trim() || place.address?.trim() || "출발지"}
                            icon="location-outline"
                            active={Boolean(selected && isSamePlace(selected, place))}
                            onPress={() => onSelect(place)}
                        />
                    ))}
                </View>
            ) : null}

            <View style={[styles.originSearchRow, selected && styles.originSearchRowSelected]}>
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <TextInput
                    value={query}
                    onChangeText={onQueryChange}
                    onSubmitEditing={onSearch}
                    editable={!searching}
                    returnKeyType="search"
                    autoCorrect={false}
                    placeholder="집, 회사 또는 도로명 주소 검색"
                    placeholderTextColor={colors.textDisabled}
                    style={styles.originSearchInput}
                    accessibilityLabel="기본 출발지 검색"
                />
                <Pressable
                    disabled={searching || !query.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="출발지 검색"
                    onPress={onSearch}
                    style={({ pressed }) => [
                        styles.originSearchButton,
                        (searching || !query.trim()) && styles.disabled,
                        pressed && styles.pressed,
                    ]}
                >
                    {searching ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                        <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
                    )}
                </Pressable>
            </View>

            {selected && hasFavoriteDepartureCoords(selected) ? (
                <View style={styles.selectedOriginRow}>
                    <Ionicons name="checkmark-circle" size={17} color={BRAND_BLUE} />
                    <View style={styles.selectedOriginCopy}>
                        <Text numberOfLines={1} style={styles.selectedOriginTitle}>
                            {selected.name?.trim() || "선택한 출발지"}
                        </Text>
                        {selected.address ? (
                            <Text numberOfLines={1} style={styles.selectedOriginAddress}>{selected.address}</Text>
                        ) : null}
                    </View>
                </View>
            ) : null}

            {results.length > 0 ? (
                <View style={styles.originResultList}>
                    {results.map((place, index) => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${place.name || "장소"}, ${place.address || "주소 정보 없음"} 선택`}
                            key={`${place.providerPlaceId ?? place.name}:${place.lat}:${place.lng}`}
                            onPress={() => onSelect(place)}
                            style={({ pressed }) => [
                                styles.originResultRow,
                                index > 0 && styles.originResultRowDivider,
                                pressed && styles.pressed,
                            ]}
                        >
                            <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                            <View style={styles.originResultCopy}>
                                <Text numberOfLines={1} style={styles.originResultTitle}>{place.name}</Text>
                                <Text numberOfLines={1} style={styles.originResultAddress}>{place.address}</Text>
                            </View>
                        </Pressable>
                    ))}
                </View>
            ) : null}

            {error ? <Text style={styles.originSearchError}>{error}</Text> : null}
        </View>
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
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
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
                    color={active ? "#FFFFFF" : colors.textSecondary}
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
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.primaryButton,
                disabled && styles.primaryButtonDisabled,
                pressed && !disabled && styles.pressed,
            ]}
        >
            <Text style={[styles.primaryButtonText, disabled && styles.primaryButtonTextDisabled]}>{label}</Text>
            <Ionicons name="arrow-forward" size={18} color={disabled ? colors.textDisabled : "#FFFFFF"} />
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
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [styles.ghostButton, pressed && !disabled && styles.pressed]}
        >
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

function getScanProgressPresentation(
    progress: CalendarScanProgress,
    deviceProviderLabel: string
): { stage: 0 | 1; message: string } {
    switch (progress) {
        case "device-permission":
            return { stage: 0, message: `${deviceProviderLabel} 접근 권한을 확인하고 있어요` };
        case "device-events":
            return { stage: 1, message: `${deviceProviderLabel}의 다가오는 일정을 확인하고 있어요` };
        case "google-auth":
            return { stage: 0, message: "Google 계정 연결을 기다리고 있어요" };
        case "google-events":
            return { stage: 1, message: "Google Calendar의 다가오는 일정을 확인하고 있어요" };
    }
}

function formatCalendarScanFailures(failures: CalendarProviderScanFailure[]): string {
    return failures
        .map((failure) => `${failure.providerLabel}: ${failure.message}`)
        .join("\n");
}

function buildCalendarProviderOptions(deviceProviderLabel: string): CalendarProviderOption[] {
    const deviceDescription = Platform.OS === "ios"
        ? "이 iPhone에 동기화된 일정"
        : "이 Android 기기에 동기화된 일정";

    return [
        {
            id: "device",
            title: deviceProviderLabel,
            description: deviceDescription,
            icon: Platform.OS === "ios" ? "logo-apple" : "phone-portrait-outline",
            available: true,
        },
        {
            id: "google",
            title: "Google Calendar",
            description: "Google 계정에 저장된 일정",
            icon: "logo-google",
            available: true,
        },
    ];
}

function buildCalendarConsentItems(
    selectedProviderIds: Set<CalendarProviderId>,
    deviceProviderLabel: string
): CalendarConsentItem[] {
    const items: CalendarConsentItem[] = [];

    if (selectedProviderIds.has("device")) {
        items.push({
            id: "device_access",
            title: `${deviceProviderLabel} 접근`,
            summary: "캘린더 목록과 다가오는 일정 정보를 읽어요.",
            required: true,
            detail: [
                "캘린더 이름, 일정 제목, 시작/종료 시간, 장소, 메모, 종일 여부를 일정 후보로 확인합니다.",
                "선택한 일정의 장소와 메모는 출발지·도착지 후보를 찾고 경로를 준비하는 데 사용합니다.",
                "원본 캘린더의 일정은 수정하거나 삭제하지 않습니다.",
                "기기 권한은 iOS/Android 설정에서 언제든 철회할 수 있습니다.",
            ],
        });
    }

    if (selectedProviderIds.has("google")) {
        items.push({
            id: "google_access",
            title: "Google Calendar 연동",
            summary: "Google 동의 후 읽기 전용으로 일정을 확인해요.",
            required: true,
            detail: [
                "Google Calendar API의 읽기 전용 범위로 캘린더 목록과 다가오는 일정 후보를 조회합니다.",
                "선택한 일정의 장소와 메모는 출발지·도착지 후보를 찾고 경로를 준비하는 데 사용합니다.",
                "접근 토큰은 기기 보안 저장소에 저장되며 현재 서버에는 저장하지 않습니다.",
                "Google 계정 보안 설정에서 연동 권한을 철회할 수 있습니다.",
            ],
        });
    }

    items.push(
        {
            id: "candidate_review",
            title: "일정 후보 확인",
            summary: "가져올 일정은 직접 선택해요.",
            required: true,
            detail: [
                "장소와 시간이 있는 일정은 기본 추천으로 표시합니다.",
                "장소와 메모의 명시적인 이동 표현만 분석하며, 찾지 못한 위치는 임의로 확정하지 않습니다.",
                "종일 일정이나 시간이 애매한 일정은 확인이 필요한 후보로 표시합니다.",
                "후보 목록에서 전체 선택, 전체 해제, 캘린더별 선택을 할 수 있습니다.",
            ],
        },
        {
            id: "selected_schedule_storage",
            title: "선택 일정 저장",
            summary: "선택한 일정만 NoLate에 저장해요.",
            required: true,
            detail: [
                "외부 캘린더 전체 원본을 서버에 일괄 저장하지 않습니다.",
                "사용자가 가져오기로 선택한 일정의 제목, 시간, 장소, 메모, 카테고리, 경로와 알림 설정만 저장합니다.",
                "저장된 일정은 NoLate 일정 화면에서 수정하거나 삭제할 수 있습니다.",
            ],
        }
    );

    return items;
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
    const brandTint = isDark ? "rgba(36,107,254,0.18)" : "rgba(36,107,254,0.08)";

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
            gap: 14,
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
        scroll: {
            flex: 1,
        },
        curationProgress: {
            flex: 1,
            height: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
        },
        curationProgressSegment: {
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.10)",
        },
        curationProgressSegmentActive: {
            backgroundColor: BRAND_BLUE,
        },
        content: {
            flexGrow: 1,
            justifyContent: "flex-start",
            paddingTop: 52,
            paddingBottom: 36,
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
        completeLogoWrap: {
            width: 68,
            height: 68,
            borderRadius: 20,
            overflow: "hidden",
            backgroundColor: BRAND_BLUE,
            marginBottom: 10,
        },
        stepIcon: {
            width: 60,
            height: 60,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: brandTint,
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
            borderColor: BRAND_BLUE,
            backgroundColor: brandTint,
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
            backgroundColor: BRAND_BLUE,
            borderColor: BRAND_BLUE,
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
        consentCard: {
            borderRadius: 18,
            overflow: "hidden",
            backgroundColor: isDark ? "#17191F" : "#FFFFFF",
            borderWidth: 1,
            borderColor: colors.border,
        },
        consentAllRow: {
            minHeight: 70,
            paddingHorizontal: 14,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 11,
            backgroundColor: isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.018)",
        },
        consentCheck: {
            width: 27,
            height: 27,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: colors.border,
            backgroundColor: isDark ? "#14161B" : "#FFFFFF",
        },
        consentCheckCompact: {
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.4,
            borderColor: colors.border,
            backgroundColor: isDark ? "#14161B" : "#FFFFFF",
        },
        consentCheckSelected: {
            borderColor: BRAND_BLUE,
            backgroundColor: BRAND_BLUE,
        },
        consentCopy: {
            flex: 1,
            minWidth: 0,
            gap: 3,
        },
        consentAllTitle: {
            color: colors.textPrimary,
            fontSize: 15,
            lineHeight: 20,
            fontWeight: "900",
        },
        consentItemList: {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
        },
        consentItem: {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: isDark ? "rgba(255,255,255,0.065)" : "rgba(0,0,0,0.055)",
        },
        consentItemHeader: {
            minHeight: 62,
            flexDirection: "row",
            alignItems: "stretch",
        },
        consentItemToggle: {
            flex: 1,
            minWidth: 0,
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 11,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        consentTitleRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            minWidth: 0,
        },
        consentItemTitle: {
            flexShrink: 1,
            color: colors.textPrimary,
            fontSize: 13,
            lineHeight: 18,
            fontWeight: "900",
        },
        consentRequired: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 15,
            fontWeight: "900",
        },
        consentDescription: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "800",
        },
        consentChevron: {
            width: 44,
            alignItems: "center",
            justifyContent: "center",
        },
        consentDetailList: {
            gap: 7,
            paddingHorizontal: 16,
            paddingTop: 2,
            paddingBottom: 13,
            paddingLeft: 48,
        },
        consentDetailRow: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 6,
        },
        consentDetailBullet: {
            width: 7,
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 17,
            fontWeight: "900",
        },
        consentDetailText: {
            flex: 1,
            minWidth: 0,
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 17,
            fontWeight: "700",
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
            borderColor: BRAND_BLUE,
            backgroundColor: brandTint,
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
            backgroundColor: BRAND_BLUE,
            borderColor: BRAND_BLUE,
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
            borderColor: BRAND_BLUE,
            backgroundColor: brandTint,
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
            borderColor: BRAND_BLUE,
            backgroundColor: brandTint,
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
            backgroundColor: BRAND_BLUE,
            borderColor: BRAND_BLUE,
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
            color: "#FFFFFF",
            backgroundColor: BRAND_BLUE,
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
        categoryStatus: {
            minHeight: 52,
            borderRadius: 15,
            paddingHorizontal: 13,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
            backgroundColor: colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
        },
        categoryStatusError: {
            alignItems: "flex-start",
        },
        categoryStatusCopy: {
            flex: 1,
            minWidth: 0,
            gap: 2,
        },
        categoryStatusTitle: {
            color: colors.textPrimary,
            fontSize: 13,
            lineHeight: 18,
            fontWeight: "900",
        },
        categoryStatusText: {
            flexShrink: 1,
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 17,
            fontWeight: "800",
        },
        defaultOriginWrap: {
            gap: 10,
        },
        originSearchRow: {
            minHeight: 54,
            borderRadius: 16,
            paddingLeft: 14,
            paddingRight: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.border,
        },
        originSearchRowSelected: {
            borderColor: BRAND_BLUE,
        },
        originSearchInput: {
            flex: 1,
            minWidth: 0,
            height: 52,
            paddingVertical: 0,
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "800",
        },
        originSearchButton: {
            width: 38,
            height: 38,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: BRAND_BLUE,
        },
        selectedOriginRow: {
            minHeight: 48,
            paddingHorizontal: 12,
            paddingVertical: 9,
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
            borderRadius: 14,
            backgroundColor: brandTint,
        },
        selectedOriginCopy: {
            flex: 1,
            minWidth: 0,
            gap: 2,
        },
        selectedOriginTitle: {
            color: colors.textPrimary,
            fontSize: 13,
            lineHeight: 18,
            fontWeight: "900",
        },
        selectedOriginAddress: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 15,
            fontWeight: "700",
        },
        originResultList: {
            overflow: "hidden",
            borderRadius: 16,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.border,
        },
        originResultRow: {
            minHeight: 58,
            paddingHorizontal: 13,
            paddingVertical: 9,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        originResultRowDivider: {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
        },
        originResultCopy: {
            flex: 1,
            minWidth: 0,
            gap: 3,
        },
        originResultTitle: {
            color: colors.textPrimary,
            fontSize: 13,
            lineHeight: 18,
            fontWeight: "900",
        },
        originResultAddress: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 15,
            fontWeight: "700",
        },
        originSearchError: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "800",
        },
        routePreparationNotice: {
            minHeight: 52,
            paddingHorizontal: 12,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            borderRadius: 15,
            backgroundColor: isDark ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.035)",
        },
        routePreparationNoticeText: {
            flex: 1,
            minWidth: 0,
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 18,
            fontWeight: "800",
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
            backgroundColor: BRAND_BLUE,
            borderColor: BRAND_BLUE,
        },
        optionChipText: {
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: "900",
        },
        optionChipTextActive: {
            color: "#FFFFFF",
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
        ghostButton: {
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
        },
        primaryButton: {
            minHeight: 56,
            borderRadius: 18,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: BRAND_BLUE,
        },
        primaryButtonText: {
            color: "#FFFFFF",
            fontSize: 15,
            fontWeight: "900",
        },
        primaryButtonDisabled: {
            backgroundColor: isDark ? "#272A31" : "#E4E7EC",
        },
        primaryButtonTextDisabled: {
            color: colors.textDisabled,
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

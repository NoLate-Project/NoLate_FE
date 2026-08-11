import { usePreventRemove } from '@react-navigation/native';
import * as GoogleAuth from 'expo-auth-session/providers/google';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  BackHandler,
  Easing,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FREE_SUBSCRIPTION_POLICY,
  getMySubscriptionPolicy,
  type SubscriptionPolicy,
} from '../../src/api/subscription';
import { useAuth } from '../../src/modules/auth/AuthContext';
import { type PlaceSearchItem } from '../../src/modules/map/routingService';
import {
  getCalendarImportSourceKey,
  getWritableCalendarImportCategories,
  hasCalendarImportCategoryOverride,
  resolveCalendarImportCategory,
} from '../../src/modules/onboarding/calendarImportCategory';
import {
  isCalendarImportManagementEntry,
  shouldConsumeCalendarImportHardwareBack,
} from '../../src/modules/onboarding/calendarImportNavigation';
import { shouldPrepareCalendarImportRoutes } from '../../src/modules/onboarding/calendarImportRouteEnrichment';
import {
  getCalendarProviderLabel,
  type DeviceCalendarCandidate,
} from '../../src/modules/onboarding/deviceCalendarImport';
import {
  GOOGLE_CALENDAR_CLIENT_ID,
  GOOGLE_CALENDAR_SCOPES,
} from '../../src/modules/onboarding/googleCalendarImport';
import {
  getFavoriteDeparturePlaces,
  hasFavoriteDepartureCoords,
} from '../../src/modules/schedule/favoriteDeparture';
import { useScheduleStore } from '../../src/modules/schedule/store';
import type { Place, TravelMode } from '../../src/modules/schedule/types';
import { useTheme } from '../../src/modules/theme/ThemeContext';
import { createCalendarImportActions } from './calendarImportActions';
import { createCalendarImportScanActions } from './calendarImportScanActions';
import { createCalendarImportStyles } from './calendarImportStyles';
import { useCalendarImportSupportActions } from './useCalendarImportSupportActions';

import {
  buildCalendarConsentItems,
  buildCalendarProviderOptions,
  buildCandidateSourceGroups,
  CalendarConsentId,
  CalendarProviderId,
  CANDIDATE_PAGE_SIZE,
  FOOTER_MOTION_DURATION_MS,
  isCalendarRouteCandidate,
  motionStepIndex,
  OnboardingStep,
  STEP_MOTION_DURATION_MS,
} from './calendarImportModel';

WebBrowser.maybeCompleteAuthSession();

/** 캘린더 가져오기 전 과정의 상태, 비동기 작업과 단계 전환을 관리합니다. */
export function useCalendarImportController() {
  const router = useRouter();
  const { source } = useLocalSearchParams<{ source?: string | string[] }>();
  const { isCurationCompleted, syncAuthentication } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const styles = createCalendarImportStyles(colors, mode);
  const { state, dispatch } = useScheduleStore();
  const deviceProviderLabel = getCalendarProviderLabel();
  const scrollViewRef = useRef<ScrollView>(null);
  const currentStepRef = useRef<OnboardingStep>('intro');
  const scanAttemptRef = useRef(0);
  const stepMotionDidMountRef = useRef(false);
  const stepMotion = useRef(new Animated.Value(1)).current;
  const footerMotion = useRef(new Animated.Value(1)).current;
  const goBackStepRef = useRef<() => void>(() => undefined);

  const [googleAuthRequest, , promptGoogleCalendarAuth] =
    GoogleAuth.useAuthRequest(
      {
        iosClientId: GOOGLE_CALENDAR_CLIENT_ID,
        androidClientId: GOOGLE_CALENDAR_CLIENT_ID,
        webClientId: GOOGLE_CALENDAR_CLIENT_ID,
        scopes: GOOGLE_CALENDAR_SCOPES,
        selectAccount: true,
        shouldAutoExchangeCode: false,
      },
      { scheme: 'nolate' },
    );

  const [step, setStep] = useState<OnboardingStep>('intro');
  const [stepTransitionDirection, setStepTransitionDirection] = useState<
    1 | -1
  >(1);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [selectedProviderIds, setSelectedProviderIds] = useState<
    Set<CalendarProviderId>
  >(() => new Set(['device']));
  const [acceptedCalendarConsentIds, setAcceptedCalendarConsentIds] = useState<
    Set<CalendarConsentId>
  >(() => new Set());
  const [expandedCalendarConsentIds, setExpandedCalendarConsentIds] = useState<
    Set<CalendarConsentId>
  >(() => new Set());
  const [scanStage, setScanStage] = useState(0);
  const [scanStatusMessage, setScanStatusMessage] =
    useState('캘린더 연결을 확인하고 있어요');
  const [candidates, setCandidates] = useState<DeviceCalendarCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [visibleCandidateCount, setVisibleCandidateCount] =
    useState(CANDIDATE_PAGE_SIZE);
  const [individualSchedulesExpanded, setIndividualSchedulesExpanded] =
    useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [categoryIdBySource, setCategoryIdBySource] = useState<
    Record<string, string>
  >({});
  const [categoryAssignmentsExpanded, setCategoryAssignmentsExpanded] =
    useState(false);
  const [expandedCategorySourceKey, setExpandedCategorySourceKey] = useState<
    string | null
  >(null);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryCreating, setCategoryCreating] = useState(false);
  const categoryLoadSequenceRef = useRef(0);
  const originSearchSequenceRef = useRef(0);
  const [travelMode, setTravelMode] = useState<TravelMode>('TRANSIT');
  const [travelMinutes, setTravelMinutes] = useState(30);
  const [prepareDepartureAlert, setPrepareDepartureAlert] = useState(false);
  const [subscriptionPolicy, setSubscriptionPolicy] =
    useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
  const [favoriteDeparturePlaces, setFavoriteDeparturePlaces] = useState<
    Place[]
  >([]);
  const [defaultOrigin, setDefaultOrigin] = useState<Place | undefined>();
  const [originSearchQuery, setOriginSearchQuery] = useState('');
  const [originSearchResults, setOriginSearchResults] = useState<
    PlaceSearchItem[]
  >([]);
  const [originSearching, setOriginSearching] = useState(false);
  const [originSearchError, setOriginSearchError] = useState<string | null>(
    null,
  );
  const defaultOriginSaveRequestIdRef = useRef(0);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [alreadyImportedCount, setAlreadyImportedCount] = useState(0);
  const [preparedRouteCount, setPreparedRouteCount] = useState(0);
  const [notificationReadyCount, setNotificationReadyCount] = useState(0);
  const [failedImportCount, setFailedImportCount] = useState(0);
  const [lastImportPreparedRoutes, setLastImportPreparedRoutes] =
    useState(false);
  const [completingCuration, setCompletingCuration] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const categories = useMemo(
    () => getWritableCalendarImportCategories(state.categories),
    [state.categories],
  );
  const selectedCategory = useMemo(
    () => resolveCalendarImportCategory(categories, categoryId),
    [categories, categoryId],
  );
  const selectedCandidates = useMemo(
    () => candidates.filter(candidate => selectedIds.has(candidate.id)),
    [candidates, selectedIds],
  );
  const candidateSourceGroups = useMemo(
    () => buildCandidateSourceGroups(candidates, selectedIds),
    [candidates, selectedIds],
  );
  const selectedCandidateSourceGroups = useMemo(
    () => candidateSourceGroups.filter(group => group.selectedCount > 0),
    [candidateSourceGroups],
  );
  const allCandidatesSelected =
    candidates.length > 0 && selectedIds.size === candidates.length;
  const routeCandidateCount = useMemo(
    () => selectedCandidates.filter(isCalendarRouteCandidate).length,
    [selectedCandidates],
  );
  const remainingNotificationQuota = Math.max(
    0,
    subscriptionPolicy.maxSmartSchedulesPerMonth -
      subscriptionPolicy.usedSmartSchedulesThisMonth,
  );
  // 목적지 후보가 하나도 없으면 공통 출발지를 받아도 경로를 만들 수 없다.
  // 이 경우 사용자가 불필요한 위치 선택 단계에 갇히지 않도록 일정 저장만 진행한다.
  const routePreparationEnabled =
    prepareDepartureAlert &&
    routeCandidateCount > 0 &&
    remainingNotificationQuota > 0;
  const defaultOriginReady = hasFavoriteDepartureCoords(defaultOrigin);
  const routesReadyForImport = shouldPrepareCalendarImportRoutes(
    routePreparationEnabled,
    defaultOriginReady,
  );
  const categoryOverrideCount = selectedCandidateSourceGroups.filter(group =>
    hasCalendarImportCategoryOverride(
      categories,
      selectedCategory?.id ?? '',
      categoryIdBySource,
      group.key,
    ),
  ).length;
  const providerOptions = useMemo(
    () => buildCalendarProviderOptions(deviceProviderLabel),
    [deviceProviderLabel],
  );
  const calendarConsentItems = useMemo(
    () => buildCalendarConsentItems(selectedProviderIds, deviceProviderLabel),
    [deviceProviderLabel, selectedProviderIds],
  );
  const calendarConsentItemIds = useMemo(
    () => calendarConsentItems.map(item => item.id),
    [calendarConsentItems],
  );
  const allCalendarConsentsAccepted = calendarConsentItems.every(
    item => !item.required || acceptedCalendarConsentIds.has(item.id),
  );
  const providerCtaLabel =
    selectedProviderIds.size === 0
      ? '캘린더를 선택해 주세요'
      : `${selectedProviderIds.size}개 캘린더로 계속`;
  const permissionProviderLabel = useMemo(() => {
    const labels = [
      selectedProviderIds.has('device') ? deviceProviderLabel : null,
      selectedProviderIds.has('google')
        ? getCalendarProviderLabel('GOOGLE')
        : null,
    ].filter((label): label is string => Boolean(label));

    if (labels.length === 0) return '캘린더';
    if (labels.length === 1) return labels[0];
    return '선택한 캘린더';
  }, [deviceProviderLabel, selectedProviderIds]);
  const isManagementEntry = isCalendarImportManagementEntry({
    source,
    isCurationCompleted,
  });
  const exitWithoutImportLabel = completingCuration
    ? '처리 중'
    : isManagementEntry
    ? '변경 없이 프로필로 돌아가기'
    : '일정 없이 시작하기';
  const navigationBusy = importing || completingCuration || categoryCreating;
  const canGoBack =
    !navigationBusy &&
    step !== 'complete' &&
    (step !== 'intro' || isManagementEntry);

  usePreventRemove(categoryCreating, () => {
    Alert.alert(
      '카테고리를 추가하고 있어요',
      '추가가 끝난 뒤 이전 화면으로 이동해 주세요.',
    );
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
    const nextDirection =
      motionStepIndex(nextStep) < motionStepIndex(currentStep) ? -1 : 1;

    setStepTransitionDirection(nextDirection);
    currentStepRef.current = nextStep;
    setStep(nextStep);
  };

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) setReduceMotionEnabled(enabled);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReduceMotionEnabled,
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

  const {
    loadCategories,
    handleCategoryCreated,
    persistCurationCompletion,
    finishCuration,
    searchDefaultOrigin,
    changeOriginSearchQuery,
    selectDefaultOrigin,
    toggleProvider,
    toggleCalendarConsent,
    toggleAllCalendarConsents,
    toggleCalendarConsentDetail,
  } = useCalendarImportSupportActions({
    categoryLoadSequenceRef,
    dispatch,
    setCategoryLoading,
    setCategoryError,
    setErrorMessage,
    setCategoryId,
    expandedCategorySourceKey,
    setCategoryIdBySource,
    setExpandedCategorySourceKey,
    isCurationCompleted,
    syncAuthentication,
    completingCuration,
    importing,
    categoryCreating,
    isManagementEntry,
    step,
    scanAttemptRef,
    router,
    setCompletingCuration,
    originSearchQuery,
    originSearching,
    originSearchSequenceRef,
    setOriginSearching,
    setOriginSearchError,
    setOriginSearchResults,
    setOriginSearchQuery,
    defaultOriginSaveRequestIdRef,
    setDefaultOrigin,
    setFavoriteDeparturePlaces,
    setSelectedProviderIds,
    setAcceptedCalendarConsentIds,
    allCalendarConsentsAccepted,
    calendarConsentItemIds,
    calendarConsentItems,
    setExpandedCalendarConsentIds,
  });

  useEffect(() => {
    loadCategories().catch(() => undefined);
    return () => {
      categoryLoadSequenceRef.current += 1;
    };
  }, [loadCategories]);

  useEffect(() => {
    if (!expandedCategorySourceKey) return;

    // 선택 화면으로 돌아가 캘린더를 해제했을 때, 보이지 않는 이전 대상에
    // 새 카테고리가 배정되지 않도록 더 이상 유효하지 않은 확장 상태를 닫는다.
    const sourceStillSelected = selectedCandidateSourceGroups.some(
      group => group.key === expandedCategorySourceKey,
    );
    if (!sourceStillSelected) setExpandedCategorySourceKey(null);
  }, [expandedCategorySourceKey, selectedCandidateSourceGroups]);

  useEffect(() => {
    if (selectedCandidateSourceGroups.length > 1) return;
    setCategoryAssignmentsExpanded(false);
    setExpandedCategorySourceKey(null);
  }, [selectedCandidateSourceGroups.length]);

  useEffect(
    () => () => {
      scanAttemptRef.current += 1;
      originSearchSequenceRef.current += 1;
      defaultOriginSaveRequestIdRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    getFavoriteDeparturePlaces()
      .then(places => {
        if (cancelled) return;
        const placesWithCoordinates = places.filter(hasFavoriteDepartureCoords);
        setFavoriteDeparturePlaces(placesWithCoordinates);
        setDefaultOrigin(current => current ?? placesWithCoordinates[0]);
      })
      .catch(() => {
        // 신규 가입자는 저장된 출발지가 없을 수 있다. 검색 입력을 그대로 제공한다.
      });

    getMySubscriptionPolicy()
      .then(policy => {
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

    setAcceptedCalendarConsentIds(current => {
      const next = new Set(
        Array.from(current).filter(id => availableIds.has(id)),
      );
      return next.size === current.size ? current : next;
    });
    setExpandedCalendarConsentIds(current => {
      const next = new Set(
        Array.from(current).filter(id => availableIds.has(id)),
      );
      return next.size === current.size ? current : next;
    });
  }, [calendarConsentItemIds]);

  const goBackStep = () => {
    if (!canGoBack) return;

    switch (step) {
      case 'intro':
        if (isManagementEntry) {
          if (router.canGoBack()) router.back();
          else router.replace('/profile');
        }
        break;
      case 'provider':
        goToStep('intro');
        break;
      case 'permission':
        goToStep('provider');
        break;
      case 'scanning':
        scanAttemptRef.current += 1;
        setErrorMessage('일정 확인을 중단했어요. 준비되면 다시 시도해 주세요.');
        goToStep('permission');
        break;
      case 'select':
        goToStep('permission');
        break;
      case 'enrich':
        goToStep('select');
        break;
      default:
        break;
    }
  };
  goBackStepRef.current = goBackStep;

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (
          !shouldConsumeCalendarImportHardwareBack({
            busy: navigationBusy,
            canGoBack,
          })
        )
          return false;
        if (navigationBusy) return true;
        goBackStepRef.current();
        return true;
      },
    );

    return () => subscription.remove();
  }, [canGoBack, navigationBusy]);

  const { scanCalendars } = createCalendarImportScanActions({
    scanAttemptRef,
    selectedProviderIds,
    deviceProviderLabel,
    googleAuthRequest,
    promptGoogleCalendarAuth,
    setErrorMessage,
    goToStep,
    setScanStage,
    setScanStatusMessage,
    setCandidates,
    setSelectedIds,
    setCategoryIdBySource,
    setCategoryAssignmentsExpanded,
    setExpandedCategorySourceKey,
    setVisibleCandidateCount,
    setIndividualSchedulesExpanded,
  });

  const toggleCandidate = (candidate: DeviceCalendarCandidate) => {
    setSelectedIds(current => {
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
    setSelectedIds(new Set(candidates.map(candidate => candidate.id)));
  };

  const clearSelectedCandidates = () => {
    setSelectedIds(new Set());
  };

  const toggleCandidateSourceGroup = (sourceKey: string) => {
    const targetIds = candidates
      .filter(candidate => getCalendarImportSourceKey(candidate) === sourceKey)
      .map(candidate => candidate.id);

    if (targetIds.length === 0) return;

    setSelectedIds(current => {
      const next = new Set(current);
      const everySelected = targetIds.every(id => next.has(id));

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

  const selectCategoryForSource = (
    sourceKey: string,
    nextCategoryId: string,
  ) => {
    setCategoryIdBySource(current => {
      const next = { ...current };
      if (nextCategoryId === selectedCategory?.id) {
        delete next[sourceKey];
      } else {
        next[sourceKey] = nextCategoryId;
      }
      return next;
    });
    setExpandedCategorySourceKey(null);
  };

  const selectDefaultCategory = (nextCategoryId: string) => {
    setCategoryId(nextCategoryId);
    setCategoryIdBySource(current => {
      const retainedAssignments = Object.entries(current).filter(
        ([, assignedCategoryId]) => assignedCategoryId !== nextCategoryId,
      );
      return retainedAssignments.length === Object.keys(current).length
        ? current
        : Object.fromEntries(retainedAssignments);
    });
  };

  const { importSelectedSchedules } = createCalendarImportActions({
    selectedCategory,
    routesReadyForImport,
    selectedCandidates,
    importing,
    categoryCreating,
    setImporting,
    setImportProgress,
    setAlreadyImportedCount,
    setPreparedRouteCount,
    setNotificationReadyCount,
    setFailedImportCount,
    setLastImportPreparedRoutes,
    travelMode,
    travelMinutes,
    categories,
    categoryId,
    categoryIdBySource,
    defaultOrigin,
    remainingNotificationQuota,
    subscriptionPolicy,
    dispatch,
    persistCurationCompletion,
    goToStep,
    setImportedCount,
  });

  return {
    acceptedCalendarConsentIds,
    allCalendarConsentsAccepted,
    allCandidatesSelected,
    alreadyImportedCount,
    calendarConsentItems,
    canGoBack,
    candidateSourceGroups,
    candidates,
    categories,
    categoryAssignmentsExpanded,
    categoryCreating,
    categoryError,
    categoryId,
    categoryIdBySource,
    categoryLoading,
    categoryOverrideCount,
    changeOriginSearchQuery,
    clearSelectedCandidates,
    completingCuration,
    colors,
    defaultOrigin,
    defaultOriginReady,
    errorMessage,
    exitWithoutImportLabel,
    expandedCalendarConsentIds,
    expandedCategorySourceKey,
    failedImportCount,
    favoriteDeparturePlaces,
    finishCuration,
    footerMotionStyle,
    goBackStep,
    goToStep,
    handleCategoryCreated,
    importProgress,
    importSelectedSchedules,
    importedCount,
    importing,
    individualSchedulesExpanded,
    insets,
    lastImportPreparedRoutes,
    loadCategories,
    notificationReadyCount,
    mode,
    originSearchError,
    originSearchQuery,
    originSearchResults,
    originSearching,
    permissionProviderLabel,
    preparedRouteCount,
    providerCtaLabel,
    providerOptions,
    remainingNotificationQuota,
    routeCandidateCount,
    routePreparationEnabled,
    routesReadyForImport,
    scanCalendars,
    scanStage,
    scanStatusMessage,
    scrollViewRef,
    searchDefaultOrigin,
    selectAllCandidates,
    selectCategoryForSource,
    selectDefaultCategory,
    selectDefaultOrigin,
    selectedCandidateSourceGroups,
    selectedCandidates,
    selectedCategory,
    selectedIds,
    selectedProviderIds,
    setCategoryAssignmentsExpanded,
    setCategoryCreating,
    setExpandedCategorySourceKey,
    setIndividualSchedulesExpanded,
    setPrepareDepartureAlert,
    setTravelMinutes,
    setTravelMode,
    setVisibleCandidateCount,
    step,
    stepMotionStyle,
    styles,
    toggleAllCalendarConsents,
    toggleCalendarConsent,
    toggleCalendarConsentDetail,
    toggleCandidate,
    toggleCandidateSourceGroup,
    toggleProvider,
    travelMinutes,
    travelMode,
    visibleCandidateCount,
  };
}

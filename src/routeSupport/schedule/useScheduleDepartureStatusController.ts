import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import {
  getScheduleDepartureStatus,
  type ScheduleDepartureStatus,
} from '../../api/schedule';
import { resolveAcceptedDepartureStatus } from '../../modules/schedule/effectiveTransitRoutePresentation';
import {
  getDepartureStatusRefreshDelay,
  isDepartureStatusLocallyExpired,
} from '../../modules/schedule/departureStatusRefreshPolicy';

type ScheduleDepartureStatusControllerOptions = {
  scheduleId?: string;
  previewEnabled: boolean;
  routePlannerSessionId?: string;
  routeSavePending: boolean;
};

/**
 * 일정 상세 화면이 활성화된 동안 서버의 최신 출발 시각과 대중교통 경로 변경 상태를 관리한다.
 * 포커스·앱 전경 상태·경로 편집 여부를 함께 확인하고, 이전 일정의 늦은 응답이 현재 화면에
 * 반영되지 않도록 요청 세대와 일정 ID를 검증한다. 서버가 제안한 다음 확인 시각은 상·하한이
 * 적용된 타이머로 예약하며, 만료된 상태의 재조회가 실패하면 저장된 일정 정보로 안전하게 복귀한다.
 */
export function useScheduleDepartureStatusController({
  scheduleId,
  previewEnabled,
  routePlannerSessionId,
  routeSavePending,
}: ScheduleDepartureStatusControllerOptions) {
  const isFocused = useIsFocused();
  const [departureStatus, setDepartureStatus] =
    useState<ScheduleDepartureStatus>();
  const [acceptedDepartureStatus, setAcceptedDepartureStatus] =
    useState<ScheduleDepartureStatus>();
  const [departureStatusNextCheckAt, setDepartureStatusNextCheckAt] = useState<
    string | null
  >();
  const [departureStatusRefreshRevision, setDepartureStatusRefreshRevision] =
    useState(0);
  const [appStateStatus, setAppStateStatus] = useState(AppState.currentState);
  const activeScheduleIdRef = useRef<string | undefined>(scheduleId);
  const requestRef = useRef<
    | {
        scheduleId: string;
        promise: Promise<void>;
      }
    | undefined
  >(undefined);
  const requestGenerationRef = useRef(0);
  const etaRefreshDueAtRef = useRef<string | null | undefined>(undefined);
  const evaluatedAtRef = useRef<string | undefined>(undefined);
  const refreshEligible = Boolean(
    scheduleId &&
      !previewEnabled &&
      isFocused &&
      appStateStatus === 'active' &&
      !routePlannerSessionId &&
      !routeSavePending,
  );
  const refreshEligibleRef = useRef(refreshEligible);
  refreshEligibleRef.current = refreshEligible;

  useEffect(() => {
    setDepartureStatus(undefined);
    setAcceptedDepartureStatus(undefined);
    setDepartureStatusNextCheckAt(undefined);
    requestGenerationRef.current += 1;
    requestRef.current = undefined;
    etaRefreshDueAtRef.current = undefined;
    evaluatedAtRef.current = undefined;
    setDepartureStatusRefreshRevision(0);
  }, [scheduleId]);

  useLayoutEffect(() => {
    activeScheduleIdRef.current = scheduleId;
    return () => {
      if (activeScheduleIdRef.current === scheduleId) {
        activeScheduleIdRef.current = undefined;
      }
    };
  }, [scheduleId]);

  /**
   * 동일 일정의 중복 요청은 진행 중 Promise를 재사용하고, 응답 시점에도 일정·요청 세대·화면
   * 활성 조건이 모두 그대로인지 확인한다. 유효한 응답만 실시간 출발 상태로 채택하며, 실패한
   * 응답이 로컬 만료 시각을 넘겼다면 오래된 실시간 값은 제거하고 저장 일정 값을 사용하게 한다.
   */
  const refreshDepartureStatus = useCallback((): Promise<void> => {
    if (!scheduleId || !refreshEligibleRef.current) {
      return Promise.resolve();
    }

    const inFlight = requestRef.current;
    if (inFlight?.scheduleId === scheduleId) return inFlight.promise;

    const requestedScheduleId = scheduleId;
    const requestGeneration = requestGenerationRef.current;
    const isCurrentRequest = () =>
      activeScheduleIdRef.current === requestedScheduleId &&
      requestGenerationRef.current === requestGeneration &&
      refreshEligibleRef.current;
    let request: Promise<void>;
    request = getScheduleDepartureStatus(requestedScheduleId)
      .then(status => {
        if (!isCurrentRequest()) return;
        setDepartureStatus(status);
        setAcceptedDepartureStatus(resolveAcceptedDepartureStatus(status));
        setDepartureStatusNextCheckAt(status.nextCheckAt);
        etaRefreshDueAtRef.current = status.etaRefreshDueAt;
        evaluatedAtRef.current = status.evaluatedAt;
      })
      .catch(() => {
        // 보조 ETA 재조회 실패는 저장 일정 조회를 막지 않는다.
        if (!isCurrentRequest()) return;

        const locallyExpired = isDepartureStatusLocallyExpired({
          etaRefreshDueAt: etaRefreshDueAtRef.current,
          evaluatedAt: evaluatedAtRef.current,
          nowMs: Date.now(),
        });
        // 만료된 요청 실패도 최소 주기로 반복하지 않고 기본 재시도 간격을 사용한다.
        setDepartureStatusNextCheckAt(undefined);
        if (locallyExpired) {
          setDepartureStatus(undefined);
          setAcceptedDepartureStatus(undefined);
          etaRefreshDueAtRef.current = undefined;
          evaluatedAtRef.current = undefined;
        }
      })
      .finally(() => {
        if (isCurrentRequest()) {
          setDepartureStatusRefreshRevision(current => current + 1);
        }
        if (requestRef.current?.promise === request) {
          requestRef.current = undefined;
        }
      });
    requestRef.current = { scheduleId: requestedScheduleId, promise: request };
    return request;
  }, [scheduleId]);

  useEffect(() => {
    let observedAppState = AppState.currentState;
    setAppStateStatus(observedAppState);
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === observedAppState) return;
      observedAppState = nextState;
      setAppStateStatus(nextState);
    });
    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    if (refreshEligible) return;
    // 포커스를 잃거나 경로 편집·저장에 진입하면 기존 요청 문맥을 즉시 무효화한다.
    requestGenerationRef.current += 1;
    requestRef.current = undefined;
  }, [refreshEligible]);

  useEffect(() => {
    if (!refreshEligible) return;
    refreshDepartureStatus();
  }, [refreshDepartureStatus, refreshEligible]);

  useEffect(() => {
    if (!refreshEligible) return undefined;

    const delay = getDepartureStatusRefreshDelay({
      nextCheckAt: departureStatusNextCheckAt,
      nowMs: Date.now(),
    });
    const timeoutId = setTimeout(() => {
      refreshDepartureStatus();
    }, delay);
    return () => clearTimeout(timeoutId);
  }, [
    departureStatusNextCheckAt,
    departureStatusRefreshRevision,
    refreshDepartureStatus,
    refreshEligible,
  ]);

  useEffect(() => {
    if (!routeSavePending) return;
    setDepartureStatus(undefined);
    setAcceptedDepartureStatus(undefined);
    setDepartureStatusNextCheckAt(undefined);
    etaRefreshDueAtRef.current = undefined;
    evaluatedAtRef.current = undefined;
  }, [routeSavePending]);

  return {
    departureStatus,
    acceptedDepartureStatus,
  };
}

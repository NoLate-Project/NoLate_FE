import * as AuthSession from 'expo-auth-session';
import * as GoogleAuth from 'expo-auth-session/providers/google';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { recordCalendarScan } from '../../src/modules/onboarding/calendarConnectionStorage';
import { withCalendarImportTimeout } from '../../src/modules/onboarding/calendarImportReliability';
import { scanSelectedCalendarProviders } from '../../src/modules/onboarding/calendarImportScan';
import {
  getDefaultSelectedCandidateIds,
  getDeviceCalendarProvider,
  loadDeviceCalendarImportSummary,
  requestDeviceCalendarPermission,
  type DeviceCalendarCandidate,
} from '../../src/modules/onboarding/deviceCalendarImport';
import {
  GOOGLE_CALENDAR_CLIENT_ID,
  GOOGLE_CALENDAR_SCOPES,
  loadGoogleCalendarImportSummary,
  saveGoogleCalendarAccessToken,
} from '../../src/modules/onboarding/googleCalendarImport';
import type { CalendarProviderId, OnboardingStep } from './calendarImportModel';
import {
  CANDIDATE_PAGE_SIZE,
  GOOGLE_AUTH_TIMEOUT_MS,
  GOOGLE_TOKEN_EXCHANGE_TIMEOUT_MS,
  SECURE_STORAGE_TIMEOUT_MS,
  formatCalendarScanFailures,
  getErrorMessage,
  getScanProgressPresentation,
  mergeCalendarCandidates,
} from './calendarImportModel';

type CalendarImportScanActionParams = {
  scanAttemptRef: MutableRefObject<number>;
  selectedProviderIds: Set<CalendarProviderId>;
  deviceProviderLabel: string;
  googleAuthRequest: ReturnType<typeof GoogleAuth.useAuthRequest>[0];
  promptGoogleCalendarAuth: ReturnType<typeof GoogleAuth.useAuthRequest>[2];
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  goToStep: (step: OnboardingStep) => void;
  setScanStage: Dispatch<SetStateAction<number>>;
  setScanStatusMessage: Dispatch<SetStateAction<string>>;
  setCandidates: Dispatch<SetStateAction<DeviceCalendarCandidate[]>>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setCategoryIdBySource: Dispatch<SetStateAction<Record<string, string>>>;
  setCategoryAssignmentsExpanded: Dispatch<SetStateAction<boolean>>;
  setExpandedCategorySourceKey: Dispatch<SetStateAction<string | null>>;
  setVisibleCandidateCount: Dispatch<SetStateAction<number>>;
  setIndividualSchedulesExpanded: Dispatch<SetStateAction<boolean>>;
};

/** Google 인증과 선택된 공급자 스캔을 하나의 재시도 가능한 동작으로 구성합니다. */
export function createCalendarImportScanActions({
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
}: CalendarImportScanActionParams) {
  const scanCalendars = async () => {
    const attemptId = scanAttemptRef.current + 1;
    scanAttemptRef.current = attemptId;
    const isCurrentAttempt = () => scanAttemptRef.current === attemptId;

    setErrorMessage(null);
    goToStep('scanning');
    setScanStage(0);
    setScanStatusMessage('캘린더 연결 상태를 확인하고 있어요');

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
        onProgress: progress => {
          if (!isCurrentAttempt()) return;
          const presentation = getScanProgressPresentation(
            progress,
            deviceProviderLabel,
          );
          setScanStage(current => Math.max(current, presentation.stage));
          setScanStatusMessage(presentation.message);
        },
      });

      if (outcome.cancelled || !isCurrentAttempt()) return;

      if (outcome.scans.length === 0) {
        setErrorMessage(
          outcome.failures.length > 0
            ? formatCalendarScanFailures(outcome.failures)
            : '연결된 캘린더에서 일정을 불러오지 못했어요.',
        );
        goToStep('permission');
        return;
      }

      const loadedCandidates = mergeCalendarCandidates(
        outcome.scans.flatMap(scan => scan.summary.candidates),
      );
      setScanStage(2);
      setScanStatusMessage('가져올 일정을 확인하고 있어요');

      try {
        await withCalendarImportTimeout(
          recordCalendarScan({
            provider: outcome.scans[0].provider,
            providerLabel: outcome.scans
              .map(scan => scan.providerLabel)
              .join(' + '),
            providerLabels: outcome.scans.map(scan => scan.providerLabel),
            calendarCount: outcome.scans.reduce(
              (total, scan) => total + scan.summary.calendarCount,
              0,
            ),
            calendarNames: outcome.scans.flatMap(scan =>
              scan.summary.calendarSources.map(calendar => calendar.title),
            ),
            eventCandidateCount: loadedCandidates.length,
          }),
          {
            timeoutMs: SECURE_STORAGE_TIMEOUT_MS,
            operationName: '캘린더 연결 상태 저장',
          },
        );
      } catch (error) {
        console.warn(
          '[calendar-import] connection snapshot save delayed',
          error,
        );
      }

      if (!isCurrentAttempt()) return;

      setErrorMessage(
        outcome.failures.length > 0
          ? `일부 캘린더는 연결하지 못했어요.\n${formatCalendarScanFailures(
              outcome.failures,
            )}`
          : null,
      );
      setCandidates(loadedCandidates);
      setSelectedIds(getDefaultSelectedCandidateIds(loadedCandidates));
      setCategoryIdBySource({});
      setCategoryAssignmentsExpanded(false);
      setExpandedCategorySourceKey(null);
      setVisibleCandidateCount(CANDIDATE_PAGE_SIZE);
      setIndividualSchedulesExpanded(false);
      goToStep('select');
    } catch (error) {
      if (!isCurrentAttempt()) return;
      setErrorMessage(
        getErrorMessage(error, '캘린더 일정을 불러오지 못했어요.'),
      );
      goToStep('permission');
    }
  };

  const requestGoogleCalendarAccessToken = async (): Promise<string | null> => {
    if (!GOOGLE_CALENDAR_CLIENT_ID) {
      throw new Error(
        'Google Calendar 연결을 지금 사용할 수 없어요. 기기 캘린더를 선택하거나 잠시 후 다시 시도해 주세요.',
      );
    }

    if (!googleAuthRequest) {
      throw new Error(
        'Google Calendar 연결 준비가 아직 끝나지 않았어요. 잠시 후 다시 시도해 주세요.',
      );
    }

    const result = await withCalendarImportTimeout(promptGoogleCalendarAuth(), {
      timeoutMs: GOOGLE_AUTH_TIMEOUT_MS,
      operationName: 'Google 계정 연결',
    });
    if (result.type === 'error') {
      throw new Error(
        result.error?.message ||
          result.params?.error_description ||
          'Google 계정 연결에 실패했어요.',
      );
    }
    if (result.type !== 'success') return null;

    if (result.authentication?.accessToken) {
      await withCalendarImportTimeout(
        saveGoogleCalendarAccessToken({
          accessToken: result.authentication.accessToken,
          expiresIn: result.authentication.expiresIn,
        }),
        {
          timeoutMs: SECURE_STORAGE_TIMEOUT_MS,
          operationName: 'Google 연결 정보 저장',
        },
      );
      return result.authentication.accessToken;
    }

    const code = result.params.code;
    if (!code || !googleAuthRequest.codeVerifier) {
      throw new Error(
        'Google Calendar 연결을 완료하지 못했어요. 다시 시도해 주세요.',
      );
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
        GoogleAuth.discovery,
      ),
      {
        timeoutMs: GOOGLE_TOKEN_EXCHANGE_TIMEOUT_MS,
        operationName: 'Google 인증 완료',
      },
    );

    await withCalendarImportTimeout(
      saveGoogleCalendarAccessToken({
        accessToken: tokenResponse.accessToken,
        expiresIn: tokenResponse.expiresIn,
      }),
      {
        timeoutMs: SECURE_STORAGE_TIMEOUT_MS,
        operationName: 'Google 연결 정보 저장',
      },
    );
    return tokenResponse.accessToken;
  };

  return { scanCalendars };
}

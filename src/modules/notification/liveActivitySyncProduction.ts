import type { LiveActivityAppearance } from '../../api/notification';
import {
  endAllLiveActivities,
  endLiveActivity,
  getActiveLiveActivities,
  getLiveActivityCapabilities,
  subscribeLiveActivityEvents,
} from './liveActivity';
import { createLiveActivitySyncCoordinator } from './liveActivitySyncCoordinator';

/** 순환 의존을 피하면서 실제 알림 API 모듈을 필요한 시점에 불러온다. */
function getLiveActivityNotificationApi(): typeof import('../../api/notification') {
  return require('../../api/notification') as typeof import('../../api/notification');
}

const productionCoordinator = createLiveActivitySyncCoordinator({
  getDeviceId: () => {
    const { getOrCreatePushDeviceId } =
      require('./pushDeviceIdentity') as typeof import('./pushDeviceIdentity');
    return getOrCreatePushDeviceId();
  },
  getCapabilities: getLiveActivityCapabilities,
  getActiveActivities: getActiveLiveActivities,
  subscribeEvents: subscribeLiveActivityEvents,
  registerStartToken: payload =>
    getLiveActivityNotificationApi().registerLiveActivityStartToken(payload),
  retireStartToken: deviceId =>
    getLiveActivityNotificationApi().retireLiveActivityStartToken(deviceId),
  registerUpdateToken: (activityId, payload) =>
    getLiveActivityNotificationApi().registerLiveActivityUpdateToken(
      activityId,
      payload,
    ),
  retireActivity: (activityId, payload) =>
    getLiveActivityNotificationApi().retireLiveActivity(activityId, payload),
  end: endLiveActivity,
  endAll: endAllLiveActivities,
  onError: (message, error) => {
    if (__DEV__) console.warn(message, error);
  },
});

/** 인증된 회원의 Live Activity 이벤트 구독과 서버 토큰 동기화를 시작한다. */
export function activateLiveActivitySyncForAuthenticatedMember(
  memberId: number,
): Promise<void> {
  return productionCoordinator.activate(memberId);
}

/** 앱이 전경으로 돌아왔을 때 현재 회원의 네이티브 상태를 서버와 다시 대조한다. */
export function resumeLiveActivitySyncForAuthenticatedMember(
  memberId: number,
): Promise<void> {
  return productionCoordinator.resume(memberId);
}

/** 현재 테마를 시작 토큰 등록 값에 반영해 원격 Live Activity의 외형을 맞춘다. */
export function setLiveActivityAppearance(
  appearance: LiveActivityAppearance,
): Promise<void> {
  return productionCoordinator.setAppearance(appearance);
}

/** 로그아웃·백그라운드 전환 시 이벤트 구독과 대기 중 재시도를 즉시 중단한다. */
export function pauseLiveActivitySync(): void {
  productionCoordinator.pause();
}

/** 현재 인증 계정의 서버 토큰을 폐기하고 기기에 남은 Live Activity를 모두 종료한다. */
export async function clearLiveActivitiesForAccountCleanup(): Promise<void> {
  const { getAuthMember } =
    require('../auth/authStorage') as typeof import('../auth/authStorage');
  const memberId = (await getAuthMember())?.id;
  await productionCoordinator.clearForAccount(memberId);
}

/** 일정 완료·취소 시 해당 일정의 로컬 화면과 서버 갱신 토큰을 함께 정리한다. */
export function endLiveActivityForSchedule(
  scheduleId: string,
  recipientMemberId?: number,
): Promise<void> {
  return productionCoordinator.endSchedule(scheduleId, recipientMemberId);
}

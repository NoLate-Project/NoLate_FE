/**
 * Live Activity 동기화의 공개 진입점입니다.
 * 순수 조정기와 운영 환경 어댑터를 분리해 서로의 초기화 순서에 의존하지 않도록 합니다.
 */
export {
  createLiveActivitySyncCoordinator,
  type LiveActivitySyncCoordinator,
  type LiveActivitySyncDependencies,
} from './liveActivitySyncCoordinator';

export {
  activateLiveActivitySyncForAuthenticatedMember,
  clearLiveActivitiesForAccountCleanup,
  endLiveActivityForSchedule,
  pauseLiveActivitySync,
  resumeLiveActivitySyncForAuthenticatedMember,
  setLiveActivityAppearance,
} from './liveActivitySyncProduction';

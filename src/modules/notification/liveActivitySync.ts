import { type ActiveLiveActivity } from './liveActivity';
import {
  LIVE_ACTIVITY_REGISTRATION_RETRY_DELAYS_MS,
  LIVE_ACTIVITY_RETIREMENT_RETRY_DELAYS_MS,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  LIVE_ACTIVITY_TYPE,
  cancelRetryWait,
  nativeEventKey,
  retirementKey,
  retryBounded,
  scheduleIdAsNumber,
  startRegistrationValue,
  validMemberId,
  type LiveActivityAppearance,
  type LiveActivityPushTokenEvent,
  type LiveActivitySession,
  type LiveActivityStateChangeEvent,
  type LiveActivitySyncCoordinator,
  type LiveActivitySyncDependencies,
  type PendingActivityRetirement,
  type SyncLane,
} from './liveActivitySyncModel';

export type {
  LiveActivitySyncCoordinator,
  LiveActivitySyncDependencies,
} from './liveActivitySyncModel';

/**
 * 네이티브 Live Activity 상태와 서버 토큰 등록을 일정·회원 단위로 직렬화하는 조정기를 만든다.
 * 호출자가 주입한 네이티브/API 의존성만 사용하므로 운영 환경과 테스트에서 같은 동기화 규칙을 공유한다.
 */
export function createLiveActivitySyncCoordinator(
  dependencies: LiveActivitySyncDependencies,
): LiveActivitySyncCoordinator {
  let lifecycleEpoch = 0;
  let session: LiveActivitySession | undefined;
  let effectiveAppearance = dependencies.initialAppearance ?? 'light';
  let cleanupRequiredMemberId: number | undefined;
  let cleanupFlight: Promise<void> | undefined;
  const pendingActivityRetirements = new Map<
    string,
    PendingActivityRetirement
  >();
  const registrationRetryDelaysMs = (
    dependencies.registrationRetryDelaysMs ??
    LIVE_ACTIVITY_REGISTRATION_RETRY_DELAYS_MS
  ).filter(delay => Number.isFinite(delay) && delay >= 0);
  const retirementRetryDelaysMs = (
    dependencies.retirementRetryDelaysMs ??
    LIVE_ACTIVITY_RETIREMENT_RETRY_DELAYS_MS
  ).filter(delay => Number.isFinite(delay) && delay >= 0);

  const report = (message: string, error: unknown) => {
    dependencies.onError?.(message, error);
  };

  const isCurrent = (candidate: LiveActivitySession) =>
    session === candidate && lifecycleEpoch === candidate.epoch;

  const waitForRetry = (
    candidate: LiveActivitySession,
    lane: SyncLane,
    revision: number,
    delayMs: number,
  ): Promise<boolean> =>
    new Promise(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (shouldRetry: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (lane.cancelRetryWait === cancel) lane.cancelRetryWait = undefined;
        resolve(shouldRetry);
      };
      const cancel = () => settle(false);
      lane.cancelRetryWait = cancel;
      timer = setTimeout(() => {
        settle(isCurrent(candidate) && revision === lane.revision);
      }, delayMs);
      if (!isCurrent(candidate) || revision !== lane.revision) cancel();
    });

  const enqueue = (
    candidate: LiveActivitySession,
    key: string,
    value: string,
    task: () => Promise<void>,
    retryDelaysMs: readonly number[] = [],
  ): Promise<void> => {
    if (!isCurrent(candidate)) return Promise.resolve();
    let lane = candidate.lanes.get(key);
    if (!lane) {
      lane = { revision: 0, tail: Promise.resolve() };
      candidate.lanes.set(key, lane);
    }
    if (lane.lastSucceeded === value) return lane.tail;

    lane.revision += 1;
    cancelRetryWait(lane);
    const revision = lane.revision;
    lane.tail = lane.tail.then(async () => {
      if (!isCurrent(candidate) || revision !== lane?.revision) return;
      if (lane.lastSucceeded === value) return;
      for (let attempt = 0; ; attempt += 1) {
        if (!isCurrent(candidate) || revision !== lane.revision) return;
        try {
          await task();
          if (isCurrent(candidate) && revision === lane.revision) {
            lane.lastSucceeded = value;
          }
          return;
        } catch (error) {
          if (!isCurrent(candidate) || revision !== lane.revision) return;
          const retryDelayMs = retryDelaysMs[attempt];
          if (retryDelayMs === undefined) {
            report(`[live-activity] ${key} sync failed`, error);
            return;
          }
          const shouldRetry = await waitForRetry(
            candidate,
            lane,
            revision,
            retryDelayMs,
          );
          if (!shouldRetry) return;
        }
      }
    });
    return lane.tail;
  };

  const syncStartToken = (
    candidate: LiveActivitySession,
    pushToStartToken: string,
  ): Promise<void> => {
    if (!isCurrent(candidate) || !candidate.canRegisterStartToken) {
      return Promise.resolve();
    }
    candidate.pushToStartToken = pushToStartToken;
    const appearance = candidate.appearance;
    return enqueue(
      candidate,
      'start',
      startRegistrationValue(pushToStartToken, appearance),
      () =>
        dependencies.registerStartToken({
          deviceId: candidate.deviceId,
          activityType: LIVE_ACTIVITY_TYPE,
          pushToStartToken,
          appearance,
          schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
        }),
      registrationRetryDelaysMs,
    );
  };

  const rememberActivity = (
    candidate: LiveActivitySession,
    activity: ActiveLiveActivity,
  ): boolean => {
    if (activity.recipientMemberId !== candidate.memberId) return false;
    const latestGeneration = candidate.latestGenerationByScheduleId.get(
      activity.scheduleId,
    );
    if (
      latestGeneration !== undefined &&
      activity.generation < latestGeneration
    )
      return false;
    if (
      latestGeneration === undefined ||
      activity.generation > latestGeneration
    ) {
      candidate.latestGenerationByScheduleId.set(
        activity.scheduleId,
        activity.generation,
      );
    }
    candidate.activeById.set(activity.activityId, activity);
    candidate.endedScheduleIds.delete(activity.scheduleId);
    return true;
  };

  const syncUpdateToken = (
    candidate: LiveActivitySession,
    activityId: string,
    scheduleId: string,
    generation: number,
    updateToken: string,
  ): Promise<void> => {
    if (candidate.terminalActivityIds.has(activityId)) return Promise.resolve();
    const latestGeneration =
      candidate.latestGenerationByScheduleId.get(scheduleId);
    if (latestGeneration !== undefined && generation < latestGeneration)
      return Promise.resolve();
    const numericScheduleId = scheduleIdAsNumber(scheduleId);
    if (!numericScheduleId) return Promise.resolve();
    return enqueue(
      candidate,
      `update:${activityId}`,
      `${generation}:${updateToken}`,
      () =>
        dependencies.registerUpdateToken(activityId, {
          deviceId: candidate.deviceId,
          scheduleId: numericScheduleId,
          generation,
          updateToken,
          schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
        }),
      registrationRetryDelaysMs,
    );
  };

  const retireActivityFromServer = (
    candidate: LiveActivitySession,
    activityId: string,
    scheduleId: string,
  ): Promise<void> => {
    const numericScheduleId = scheduleIdAsNumber(scheduleId);
    if (!numericScheduleId) return Promise.resolve();
    const pendingKey = retirementKey(
      candidate.memberId,
      candidate.deviceId,
      activityId,
    );
    pendingActivityRetirements.set(pendingKey, {
      memberId: candidate.memberId,
      deviceId: candidate.deviceId,
      activityId,
      scheduleId,
    });
    candidate.terminalActivityIds.add(activityId);
    const updateLane = candidate.lanes.get(`update:${activityId}`);
    if (updateLane) {
      updateLane.revision += 1;
      cancelRetryWait(updateLane);
    }
    return (updateLane?.tail ?? Promise.resolve()).then(() =>
      enqueue(
        candidate,
        `retire:${activityId}`,
        scheduleId,
        async () => {
          await dependencies.retireActivity(activityId, {
            deviceId: candidate.deviceId,
            scheduleId: numericScheduleId,
          });
          pendingActivityRetirements.delete(pendingKey);
          candidate.activeById.delete(activityId);
        },
        retirementRetryDelaysMs,
      ),
    );
  };

  const handlePushToken = (
    candidate: LiveActivitySession,
    event: LiveActivityPushTokenEvent,
  ) => {
    if (!isCurrent(candidate)) return;
    if (
      event.recipientMemberId !== undefined &&
      event.recipientMemberId !== candidate.memberId
    )
      return;
    const key = nativeEventKey(event);
    if (!key) return;
    candidate.nativeEventRevision += 1;
    candidate.nativeEventRevisionByKey.set(key, candidate.nativeEventRevision);

    if (event.kind === 'pushToStart') {
      candidate.pendingPushToStartToken = event.token;
      const startLane = candidate.lanes.get('start');
      const registrationValue = startRegistrationValue(
        event.token,
        candidate.appearance,
      );
      if (startLane && startLane.lastSucceeded !== registrationValue) {
        // Do not let an older credential's retry timer prevent a newer
        // native rotation from reaching the reconciliation snapshot.
        startLane.revision += 1;
        cancelRetryWait(startLane);
      }
      const snapshotAlreadyInFlight = candidate.snapshotFlight;
      void (async () => {
        // A rotated start credential can race the update token of the
        // Activity created by the previous START. Finish any older
        // snapshot, take a fresh native snapshot, and only then upload
        // the new credential. `synchronizeSnapshot` itself persists all
        // known update/retirement lanes before its start-token lane.
        await snapshotAlreadyInFlight;
        if (!isCurrent(candidate)) return;
        await synchronizeSnapshot(candidate, event.token);
      })().catch(error => {
        report('[live-activity] rotated start reconciliation failed', error);
      });
      return;
    }
    if (!event.activityId || !event.scheduleId || !event.recipientMemberId)
      return;
    const activity = {
      activityId: event.activityId,
      scheduleId: event.scheduleId,
      recipientMemberId: event.recipientMemberId,
      generation: event.generation,
      revision: 0,
      status: 'preparing',
      updateToken: event.token,
    } satisfies ActiveLiveActivity;
    if (!rememberActivity(candidate, activity)) return;
    syncUpdateToken(
      candidate,
      event.activityId,
      event.scheduleId,
      event.generation,
      event.token,
    ).catch(() => undefined);
  };

  const handleStateChange = (
    candidate: LiveActivitySession,
    event: LiveActivityStateChangeEvent,
  ) => {
    if (!isCurrent(candidate) || event.recipientMemberId !== candidate.memberId)
      return;
    if (event.state === 'active' || event.state === 'stale') {
      if (event.state === 'active')
        candidate.terminalActivityIds.delete(event.activityId);
      const existing = candidate.activeById.get(event.activityId);
      if (existing) rememberActivity(candidate, existing);
      return;
    }
    retireActivityFromServer(
      candidate,
      event.activityId,
      event.scheduleId,
    ).catch(() => undefined);
  };

  const synchronizeSnapshot = (
    candidate: LiveActivitySession,
    preferredStartToken?: string,
  ): Promise<void> => {
    if (!isCurrent(candidate)) return Promise.resolve();
    if (candidate.snapshotFlight) return candidate.snapshotFlight;
    const eventRevisionAtStart = candidate.nativeEventRevision;
    const request = Promise.all([
      dependencies.getCapabilities().catch(error => {
        report('[live-activity] capability snapshot failed', error);
        return undefined;
      }),
      dependencies.getActiveActivities().catch(error => {
        report('[live-activity] activity snapshot failed', error);
        return [];
      }),
    ])
      .then(async ([capabilities, activities]) => {
        if (!isCurrent(candidate)) return;
        const operations: Promise<void>[] = [];
        const latestGenerationByScheduleId = new Map<string, number>();
        const pendingForCandidate = [
          ...pendingActivityRetirements.values(),
        ].filter(
          pending =>
            pending.memberId === candidate.memberId &&
            pending.deviceId === candidate.deviceId,
        );
        const pendingActivityIds = new Set(
          pendingForCandidate.map(pending => pending.activityId),
        );
        pendingActivityIds.forEach(activityId => {
          candidate.terminalActivityIds.add(activityId);
        });
        for (const activity of activities) {
          if (activity.recipientMemberId !== candidate.memberId) continue;
          if (pendingActivityIds.has(activity.activityId)) continue;
          latestGenerationByScheduleId.set(
            activity.scheduleId,
            Math.max(
              latestGenerationByScheduleId.get(activity.scheduleId) ?? -1,
              activity.generation,
            ),
          );
        }
        for (const activity of activities) {
          if (activity.recipientMemberId !== candidate.memberId) continue;
          if (pendingActivityIds.has(activity.activityId)) continue;
          if (
            activity.generation <
            (latestGenerationByScheduleId.get(activity.scheduleId) ?? 0)
          ) {
            continue;
          }
          if (!rememberActivity(candidate, activity)) continue;
          const key = `update:${activity.activityId}`;
          if (
            activity.updateToken &&
            (candidate.nativeEventRevisionByKey.get(key) ?? -1) <=
              eventRevisionAtStart
          ) {
            operations.push(
              syncUpdateToken(
                candidate,
                activity.activityId,
                activity.scheduleId,
                activity.generation,
                activity.updateToken,
              ),
            );
          }
        }
        for (const pending of pendingForCandidate) {
          operations.push(
            retireActivityFromServer(
              candidate,
              pending.activityId,
              pending.scheduleId,
            ),
          );
        }
        // Queue every known UPDATE/END route first so its initial attempt is
        // started ahead of the installation credential. Do not await each
        // lane's bounded retry tail: one permanent orphan must not delay or
        // repeatedly prevent unrelated remote STARTs on short foregrounds.
        void Promise.allSettled(operations);
        if (!isCurrent(candidate)) return;
        const reconciledStartToken =
          preferredStartToken ??
          candidate.pendingPushToStartToken ??
          capabilities?.pushToStartToken;
        if (capabilities) {
          candidate.canRegisterStartToken = Boolean(
            capabilities.supported &&
              capabilities.canStartRemotely &&
              capabilities.pushToStartSupported,
          );
        }

        // Advance the installation credential after those lanes have been
        // queued. The backend deliberately does not replay an ambiguous
        // START, so an orphan or unavailable old route must not block every
        // future schedule from receiving a remote START.
        if (
          candidate.canRegisterStartToken &&
          reconciledStartToken &&
          (candidate.nativeEventRevisionByKey.get('start') ?? -1) <=
            eventRevisionAtStart
        ) {
          await syncStartToken(candidate, reconciledStartToken);
          if (candidate.pendingPushToStartToken === reconciledStartToken) {
            candidate.pendingPushToStartToken = undefined;
          }
        }
      })
      .finally(() => {
        if (candidate.snapshotFlight === request)
          candidate.snapshotFlight = undefined;
      });
    candidate.snapshotFlight = request;
    return request;
  };

  const pause = () => {
    lifecycleEpoch += 1;
    const previous = session;
    session = undefined;
    previous?.lanes.forEach(lane => {
      lane.revision += 1;
      cancelRetryWait(lane);
    });
    previous?.unsubscribe();
  };

  const activate = async (memberId: number): Promise<void> => {
    if (!validMemberId(memberId)) return;
    if (cleanupFlight) {
      throw new Error('Live Activity account cleanup is in progress.');
    }
    if (
      cleanupRequiredMemberId !== undefined &&
      cleanupRequiredMemberId !== memberId
    ) {
      throw new Error(
        `Live Activity cleanup is required for account ${cleanupRequiredMemberId}.`,
      );
    }
    if (session?.memberId === memberId && isCurrent(session)) {
      await synchronizeSnapshot(session);
      return;
    }
    if (session) {
      const previousMemberId = session.memberId;
      pause();
      cleanupRequiredMemberId = previousMemberId;
      // A direct account switch that skipped the ordinary logout cleanup
      // must not leave the previous member on the lock screen.
      const cleanup = await dependencies.endAll();
      if (
        cleanup.supported &&
        !cleanup.applied &&
        cleanup.reason !== 'NOT_FOUND'
      ) {
        throw new Error(
          cleanup.reason ?? 'Live Activity account-switch cleanup failed.',
        );
      }
      throw new Error(
        `Live Activity cleanup is required before switching account ${previousMemberId}.`,
      );
    }

    const epoch = lifecycleEpoch + 1;
    lifecycleEpoch = epoch;
    const deviceId = await dependencies.getDeviceId();
    if (lifecycleEpoch !== epoch) return;
    const next: LiveActivitySession = {
      epoch,
      memberId,
      deviceId,
      appearance: effectiveAppearance,
      canRegisterStartToken: false,
      unsubscribe: () => undefined,
      nativeEventRevision: 0,
      nativeEventRevisionByKey: new Map(),
      lanes: new Map(),
      activeById: new Map(),
      latestGenerationByScheduleId: new Map(),
      terminalActivityIds: new Set(),
      endedScheduleIds: new Set(),
    };
    session = next;
    next.unsubscribe = dependencies.subscribeEvents({
      onPushToken: event => handlePushToken(next, event),
      onStateChange: event => handleStateChange(next, event),
    });
    await synchronizeSnapshot(next);
  };

  const resume = async (memberId?: number): Promise<void> => {
    if (memberId !== undefined && session?.memberId !== memberId) {
      await activate(memberId);
      return;
    }
    if (session) await synchronizeSnapshot(session);
  };

  const setAppearance = async (
    appearance: LiveActivityAppearance,
  ): Promise<void> => {
    effectiveAppearance = appearance;
    const candidate = session;
    if (
      !candidate ||
      !isCurrent(candidate) ||
      candidate.appearance === appearance
    )
      return;

    candidate.appearance = appearance;
    if (candidate.canRegisterStartToken && candidate.pushToStartToken) {
      await syncStartToken(candidate, candidate.pushToStartToken);
      return;
    }

    // A theme change can arrive while the first native snapshot is still
    // resolving. Reuse that flight, then enqueue the latest appearance with
    // any token it discovered. The composite lane value makes the second
    // call idempotent when the snapshot already uploaded the same pair.
    await synchronizeSnapshot(candidate);
    if (
      isCurrent(candidate) &&
      candidate.appearance === appearance &&
      candidate.canRegisterStartToken &&
      candidate.pushToStartToken
    ) {
      await syncStartToken(candidate, candidate.pushToStartToken);
    }
  };

  const performClearForAccount = async (memberId?: number): Promise<void> => {
    const previous = session;
    const cleanupMemberId =
      memberId ?? previous?.memberId ?? cleanupRequiredMemberId;
    if (
      cleanupRequiredMemberId !== undefined &&
      validMemberId(cleanupMemberId) &&
      cleanupRequiredMemberId !== cleanupMemberId
    ) {
      throw new Error(
        `Live Activity cleanup is required for account ${cleanupRequiredMemberId}.`,
      );
    }
    if (validMemberId(cleanupMemberId)) {
      cleanupRequiredMemberId = cleanupMemberId;
    }
    pause();

    let deviceId = previous?.deviceId;
    let deviceIdentityError: unknown;
    if (!deviceId && validMemberId(cleanupMemberId)) {
      deviceId = await dependencies.getDeviceId().catch(error => {
        deviceIdentityError = error;
        return undefined;
      });
    }
    const snapshot = validMemberId(cleanupMemberId)
      ? await dependencies.getActiveActivities().catch(error => {
          report('[live-activity] logout activity snapshot failed', error);
          return [];
        })
      : [];
    const activities = new Map<string, ActiveLiveActivity>();
    previous?.activeById.forEach((activity, id) =>
      activities.set(id, activity),
    );
    snapshot.forEach(activity => activities.set(activity.activityId, activity));
    for (const pending of pendingActivityRetirements.values()) {
      if (
        pending.memberId === cleanupMemberId &&
        (!deviceId || pending.deviceId === deviceId)
      ) {
        activities.set(pending.activityId, {
          activityId: pending.activityId,
          scheduleId: pending.scheduleId,
          recipientMemberId: pending.memberId,
          generation: 0,
          revision: 0,
          status: 'cancelled',
        });
      }
    }

    // A token registration that already crossed the HTTP boundary cannot be
    // cancelled. Wait for it before issuing retirement so an old token can
    // never become the final server value after logout.
    await Promise.allSettled(
      [...(previous?.lanes.values() ?? [])].map(lane => lane.tail),
    );

    let remoteRetirementFailure: unknown;
    if (deviceId && validMemberId(cleanupMemberId)) {
      const cleanupDeviceId = deviceId;
      const remoteRetirements: Promise<void>[] = [
        retryBounded(
          () => dependencies.retireStartToken(cleanupDeviceId),
          retirementRetryDelaysMs,
        ),
      ];
      for (const activity of activities.values()) {
        if (activity.recipientMemberId !== cleanupMemberId) continue;
        const scheduleId = scheduleIdAsNumber(activity.scheduleId);
        if (!scheduleId) continue;
        const pendingKey = retirementKey(
          cleanupMemberId,
          cleanupDeviceId,
          activity.activityId,
        );
        // Keep the server retirement address even after local endAll removes
        // the ActivityKit snapshot. A failed logout can then be retried on the
        // next foreground/logout instead of losing the old update-token row.
        pendingActivityRetirements.set(pendingKey, {
          memberId: cleanupMemberId,
          deviceId: cleanupDeviceId,
          activityId: activity.activityId,
          scheduleId: activity.scheduleId,
        });
        remoteRetirements.push(
          retryBounded(async () => {
            await dependencies.retireActivity(activity.activityId, {
              deviceId: cleanupDeviceId,
              scheduleId,
            });
            pendingActivityRetirements.delete(pendingKey);
          }, retirementRetryDelaysMs),
        );
      }
      const results = await Promise.allSettled(remoteRetirements);
      results.forEach(result => {
        if (result.status === 'rejected') {
          report(
            '[live-activity] logout server retirement failed',
            result.reason,
          );
          remoteRetirementFailure ??= result.reason;
        }
      });
    }

    // Revoke every old-account APNs route before dismissing the local surface,
    // closing the window in which a late remote START/UPDATE could recreate it.
    // Remote failures are collected rather than thrown here so local privacy
    // cleanup still runs as a finally-style boundary.
    const nativeResult = await dependencies.endAll();
    const nativeCleanupFailed =
      nativeResult.supported &&
      !nativeResult.applied &&
      nativeResult.reason !== 'NOT_FOUND';

    if (nativeCleanupFailed) {
      throw new Error(
        nativeResult.reason ?? 'Live Activity native cleanup failed.',
      );
    }
    if (deviceIdentityError) throw deviceIdentityError;
    if (remoteRetirementFailure) throw remoteRetirementFailure;
    if (cleanupRequiredMemberId === cleanupMemberId) {
      cleanupRequiredMemberId = undefined;
    }
  };

  const clearForAccount = (memberId?: number): Promise<void> => {
    if (cleanupFlight) return cleanupFlight;
    const request = performClearForAccount(memberId).finally(() => {
      if (cleanupFlight === request) cleanupFlight = undefined;
    });
    cleanupFlight = request;
    return request;
  };

  const endSchedule = async (
    scheduleId: string,
    memberId?: number,
  ): Promise<void> => {
    const candidate = session;
    if (!candidate || !isCurrent(candidate)) return;
    if (memberId !== undefined && candidate.memberId !== memberId) return;
    if (
      !scheduleIdAsNumber(scheduleId) ||
      candidate.endedScheduleIds.has(scheduleId)
    )
      return;
    candidate.endedScheduleIds.add(scheduleId);
    try {
      const result = await dependencies.end({
        scheduleId,
        recipientMemberId: candidate.memberId,
        status: 'cancelled',
        revision: Date.now(),
        updatedAt: new Date().toISOString(),
        dismissalPolicy: 'immediate',
      });
      if (!isCurrent(candidate)) return;
      if (
        result.supported &&
        !result.applied &&
        result.reason !== 'NOT_FOUND'
      ) {
        throw new Error(result.reason ?? 'Live Activity end was not applied.');
      }
      const ids = new Set<string>();
      if (result.activityId) ids.add(result.activityId);
      candidate.activeById.forEach((activity, activityId) => {
        if (activity.scheduleId === scheduleId) ids.add(activityId);
      });
      ids.forEach(activityId => candidate.terminalActivityIds.add(activityId));
      await Promise.all(
        [...ids].map(activityId =>
          retireActivityFromServer(candidate, activityId, scheduleId),
        ),
      );
    } catch (error) {
      if (isCurrent(candidate)) candidate.endedScheduleIds.delete(scheduleId);
      throw error;
    }
  };

  return {
    activate,
    resume,
    setAppearance,
    pause,
    clearForAccount,
    endSchedule,
  };
}

export {
  activateLiveActivitySyncForAuthenticatedMember,
  clearLiveActivitiesForAccountCleanup,
  endLiveActivityForSchedule,
  pauseLiveActivitySync,
  resumeLiveActivitySyncForAuthenticatedMember,
  setLiveActivityAppearance,
} from './liveActivitySyncProduction';

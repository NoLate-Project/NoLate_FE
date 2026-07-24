import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import {
    getScheduleDepartureStatus,
    getScheduleForDepartureHome,
    getSchedules,
    type ScheduleDepartureStatus,
} from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import {
    getAuthSessionEpoch,
    isAuthSessionActive,
    isAuthSessionEpochCurrent,
    subscribeAuthSessionEpoch,
} from "../auth/authSessionEpoch";
import type { ScheduleItem } from "./types";
import {
    getDepartureStatusRefreshAt,
    getDepartureVerificationItems,
    isDepartureStatusFresh,
    NEXT_DEPARTURE_STATUS_MAX_AGE_MS,
    rankNextDepartures,
} from "./nextDeparture";
import { subscribeScheduleDepartureMutation } from "./scheduleDepartureMutationEvents";

export const DEPARTURE_HOME_REQUEST_CONCURRENCY = 4;
// 최대 24개(detail + status) 요청으로 한 refresh의 비용을 제한한다.
// 12개를 넘으면 저장 출발 시각 순서를 보수적으로 유지하고 live 값으로 재정렬하지 않는다.
export const DEPARTURE_HOME_CANDIDATE_LIMIT = 12;
// 보안 redaction 복구는 ETA 후보와 분리하되 한 refresh의 detail 검증 비용을 제한한다.
export const DEPARTURE_HOME_REGRANT_VERIFICATION_LIMIT = 12;
export const DEPARTURE_HOME_RETRY_BACKOFF_MS = [
    60_000,
    2 * 60_000,
    5 * 60_000,
] as const;
const DEPARTURE_HOME_MIN_REFRESH_DELAY_MS = 1_000;

type DepartureHomeSource = "loading" | "schedules" | "calendar-fallback";
export type DepartureHomeConnectionIssue = "offline" | "error";
export type DepartureHomeDetailIssue =
    | DepartureHomeConnectionIssue
    | "verification";

type DepartureHomeSnapshot = {
    source: DepartureHomeSource;
    items: ScheduleItem[];
    candidateItems: ScheduleItem[];
    statusesByScheduleId: Record<string, ScheduleDepartureStatus | undefined>;
    statusIssuesByScheduleId: Record<
        string,
        DepartureHomeConnectionIssue | undefined
    >;
    detailIssuesByScheduleId: Record<
        string,
        DepartureHomeDetailIssue | undefined
    >;
    statusOrderingSafe: boolean;
    currentMemberId?: number;
    loading: boolean;
    connectionIssue: DepartureHomeConnectionIssue | null;
    refreshedAt: number | null;
    retryDelayMs: number | null;
};

type CandidateRequest =
    | { kind: "detail"; item: ScheduleItem; regrant?: boolean }
    | { kind: "status"; item: ScheduleItem };

type CandidateRequestResult = CandidateRequest & {
    value?: ScheduleItem | ScheduleDepartureStatus;
    error?: unknown;
};

type RetryState = {
    accountKey: string;
    fingerprint: string | null;
    consecutive: number;
};

type DepartureCandidateWindow = {
    items: ScheduleItem[];
    truncated: boolean;
};

type RegrantVerificationCursor = {
    identity: string | null;
    offset: number;
};

function selectRegrantVerificationItems(
    items: ScheduleItem[],
    redactedScheduleIds: ReadonlySet<string>,
    tombstoneScheduleIds: ReadonlySet<string>,
    currentMemberId: number | undefined,
    cursor: RegrantVerificationCursor
): {
    items: ScheduleItem[];
    cursor: RegrantVerificationCursor;
} {
    const candidates = items
        .filter((item) => (
            redactedScheduleIds.has(item.id)
            && !tombstoneScheduleIds.has(item.id)
        ))
        .sort((left, right) => left.id.localeCompare(right.id));
    const identity = JSON.stringify([
        currentMemberId ?? null,
        [...redactedScheduleIds].sort(),
        candidates.map((item) => item.id),
    ]);
    if (candidates.length === 0) {
        return {
            items: [],
            cursor: { identity, offset: 0 },
        };
    }

    const start = cursor.identity === identity
        ? cursor.offset % candidates.length
        : 0;
    const count = Math.min(
        DEPARTURE_HOME_REGRANT_VERIFICATION_LIMIT,
        candidates.length
    );
    const selected = Array.from({ length: count }, (_, index) => (
        candidates[(start + index) % candidates.length]!
    ));
    return {
        items: selected,
        cursor: {
            identity,
            offset: (start + count) % candidates.length,
        },
    };
}

function getMemberId(member: { id?: number } | null): number | undefined {
    return Number.isSafeInteger(member?.id) && (member?.id ?? 0) > 0
        ? member?.id
        : undefined;
}

function hasNetworkMetadata(error: unknown, seen = new Set<unknown>()): boolean {
    if (!error || (typeof error !== "object" && typeof error !== "function")) {
        return false;
    }
    if (seen.has(error)) return false;
    seen.add(error);

    const candidate = error as {
        code?: unknown;
        errorCode?: unknown;
        name?: unknown;
        cause?: unknown;
        isAxiosError?: unknown;
        response?: unknown;
    };
    const codes = [candidate.code, candidate.errorCode]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toUpperCase());
    if (codes.some((code) => (
        code === "ERR_NETWORK"
        || code === "ECONNABORTED"
        || code === "ETIMEDOUT"
        || code === "ENETUNREACH"
        || code === "ECONNRESET"
    ))) {
        return true;
    }
    if (candidate.name === "TimeoutError") return true;
    if (candidate.isAxiosError === true && candidate.response === undefined) {
        return codes.length > 0;
    }
    return hasNetworkMetadata(candidate.cause, seen);
}

export function getDepartureHomeConnectionIssue(
    error: unknown
): DepartureHomeConnectionIssue {
    if (error instanceof ApiResponseError && error.status !== undefined) {
        return "error";
    }
    return hasNetworkMetadata(error) ? "offline" : "error";
}

function isRolloutUnavailable(error: unknown): boolean {
    return error instanceof ApiResponseError
        && (error.status === 404 || error.status === 501);
}

function getDetailAccessFailure(
    error: unknown
): "session" | "schedule" | null {
    if (!(error instanceof ApiResponseError)) return null;
    if (error.status === 401) return "session";
    if (error.status === 403 || error.status === 404) return "schedule";
    return null;
}

function mergeConnectionIssue(
    current: DepartureHomeConnectionIssue | undefined,
    next: DepartureHomeConnectionIssue
): DepartureHomeConnectionIssue {
    return current === "offline" || next === "offline" ? "offline" : "error";
}

function getDepartureCandidateWindow(
    items: ScheduleItem[],
    now: Date,
    currentMemberId?: number
): DepartureCandidateWindow {
    const eligibleItems = getDepartureVerificationItems(
        items,
        now,
        currentMemberId
    );
    const rankedItems = rankNextDepartures(
        eligibleItems,
        {},
        now,
        currentMemberId
    ).map((candidate) => candidate.item);
    return {
        items: rankedItems.slice(0, DEPARTURE_HOME_CANDIDATE_LIMIT),
        truncated: rankedItems.length > DEPARTURE_HOME_CANDIDATE_LIMIT,
    };
}

async function mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    signal: AbortSignal,
    isCurrent: () => boolean,
    mapper: (value: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R | undefined>(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), values.length);

    const workers = Promise.all(Array.from({ length: workerCount }, async () => {
        while (!signal.aborted && isCurrent() && nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            if (signal.aborted || !isCurrent()) return;
            results[index] = await mapper(values[index]!);
        }
    }));

    if (!signal.aborted) {
        await new Promise<void>((resolve, reject) => {
            const finish = (callback: () => void) => {
                signal.removeEventListener("abort", handleAbort);
                callback();
            };
            const handleAbort = () => finish(resolve);
            signal.addEventListener("abort", handleAbort, { once: true });
            workers.then(
                () => finish(resolve),
                (error) => finish(() => reject(error))
            );
        });
    }

    return results.filter((result): result is R => result !== undefined);
}

function getFallbackRevision(items: ScheduleItem[]): string {
    return [...items]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((item) => [
            item.id,
            item.updatedAt ?? "",
            item.title,
            item.startAt,
            item.endAt,
            item.departAt ?? "",
            item.myDepartedAt ?? "",
            item.departedAt ?? "",
            item.departureParticipants?.map((participant) => (
                `${participant.memberId}:${participant.departed ? 1 : 0}`
            )).join(",") ?? "",
            item.travelMinutes ?? "",
            item.travelCollaborationEnabled ?? "",
            item.routeSetupRequired ?? "",
            item.notificationEnabled ?? "",
            item.locationName ?? "",
            item.destination?.name ?? "",
            item.destination?.address ?? "",
            item.route === null ? "route:null" : item.route ? "route:set" : "",
            item.myTravelPlan === null
                ? "plan:null"
                : item.myTravelPlan?.updatedAt ?? "",
            item.myTravelPlan?.departAt ?? "",
            item.myTravelPlan?.status ?? "",
        ].join("|"))
        .join(";");
}

function mergeScheduleItems(
    currentItems: ScheduleItem[],
    fallbackItems: ScheduleItem[]
): ScheduleItem[] {
    const merged = new Map(currentItems.map((item) => [item.id, item]));
    fallbackItems.forEach((item) => {
        merged.set(item.id, {
            ...(merged.get(item.id) ?? {}),
            ...item,
        } as ScheduleItem);
    });
    return Array.from(merged.values());
}

function removeScheduleIdsFromItems(
    items: ScheduleItem[],
    removedIds: ReadonlySet<string>
): ScheduleItem[] {
    return removedIds.size === 0
        ? items
        : items.filter((item) => !removedIds.has(item.id));
}

function removeScheduleIdsFromRecord<T>(
    record: Record<string, T | undefined>,
    removedIds: ReadonlySet<string>
): Record<string, T | undefined> {
    if (removedIds.size === 0) return record;
    return Object.fromEntries(
        Object.entries(record).filter(([scheduleId]) => (
            !removedIds.has(scheduleId)
        ))
    );
}

function markStatusesStale(
    statuses: DepartureHomeSnapshot["statusesByScheduleId"]
): DepartureHomeSnapshot["statusesByScheduleId"] {
    return Object.fromEntries(
        Object.entries(statuses).map(([scheduleId, status]) => [
            scheduleId,
            status ? { ...status, stale: true } : status,
        ])
    );
}

function getRetryFingerprint({
    connectionIssue,
    statusesByScheduleId,
    statusIssuesByScheduleId,
    detailIssuesByScheduleId,
}: Pick<
    DepartureHomeSnapshot,
    | "connectionIssue"
    | "statusesByScheduleId"
    | "statusIssuesByScheduleId"
    | "detailIssuesByScheduleId"
>, now: Date): string | null {
    if (connectionIssue) return `list:${connectionIssue}`;

    const parts = [
        ...Object.entries(statusIssuesByScheduleId).map(
            ([id, issue]) => `status:${id}:${issue}`
        ),
        ...Object.entries(detailIssuesByScheduleId).map(
            ([id, issue]) => `detail:${id}:${issue}`
        ),
        ...Object.values(statusesByScheduleId)
            .filter((status): status is ScheduleDepartureStatus => (
                Boolean(status) && !isDepartureStatusFresh(status!, now)
            ))
            .map((status) => [
                "stale",
                status.scheduleId,
                status.source ?? "unknown",
                status.stale ? "stale" : "expired",
                status.failureReason ?? "",
                status.confidence ?? "",
                status.lastChangedAt ?? "",
                status.lastTrafficChangeMinutes ?? "",
            ].join(":")),
    ].sort();
    return parts.length > 0 ? parts.join("|") : null;
}

function getRefreshDelay(snapshot: DepartureHomeSnapshot, now: number): number {
    if (snapshot.retryDelayMs !== null) return snapshot.retryDelayMs;

    const fallbackTarget = (snapshot.refreshedAt ?? now)
        + NEXT_DEPARTURE_STATUS_MAX_AGE_MS;
    const statusTargets = Object.values(snapshot.statusesByScheduleId)
        .filter((status): status is ScheduleDepartureStatus => Boolean(status))
        .map((status) => getDepartureStatusRefreshAt(status, new Date(now)));
    const target = Math.min(fallbackTarget, ...statusTargets);
    return Math.min(
        NEXT_DEPARTURE_STATUS_MAX_AGE_MS,
        Math.max(DEPARTURE_HOME_MIN_REFRESH_DELAY_MS, target - now)
    );
}

function createInitialSnapshot(): DepartureHomeSnapshot {
    return {
        source: "loading",
        items: [],
        candidateItems: [],
        statusesByScheduleId: {},
        statusIssuesByScheduleId: {},
        detailIssuesByScheduleId: {},
        statusOrderingSafe: true,
        loading: true,
        connectionIssue: null,
        refreshedAt: null,
        retryDelayMs: null,
    };
}

export function useNextDepartureHome({
    fallbackItems,
    focused,
    authoritativeRemovedScheduleIds,
    authoritativeRedactedScheduleIds,
    onScheduleAccessRevoked,
    onScheduleAuthoritativelyRemoved,
    onScheduleRestored,
    onFullSchedulesVerified,
    onSessionAccessRejected,
}: {
    fallbackItems: ScheduleItem[];
    focused: boolean;
    authoritativeRemovedScheduleIds?: ReadonlySet<string>;
    authoritativeRedactedScheduleIds?: ReadonlySet<string>;
    onScheduleAccessRevoked?: (scheduleId: string) => void;
    onScheduleAuthoritativelyRemoved?: (scheduleId: string) => void;
    onScheduleRestored?: (item: ScheduleItem) => void;
    onFullSchedulesVerified?: (items: ScheduleItem[]) => void;
    onSessionAccessRejected?: () => void;
}) {
    const requestSequenceRef = useRef(0);
    const authEpochRef = useRef(getAuthSessionEpoch());
    const collectionEpochRef = useRef(0);
    const activeControllerRef = useRef<AbortController | null>(null);
    const focusedRef = useRef(focused);
    const pendingRefreshRef = useRef(false);
    const regrantVerificationCursorRef = useRef<RegrantVerificationCursor>({
        identity: null,
        offset: 0,
    });
    const authoritativeRemovedScheduleIdsRef = useRef(
        authoritativeRemovedScheduleIds
    );
    authoritativeRemovedScheduleIdsRef.current =
        authoritativeRemovedScheduleIds;
    const authoritativeRedactedScheduleIdsRef = useRef(
        authoritativeRedactedScheduleIds
    );
    authoritativeRedactedScheduleIdsRef.current =
        authoritativeRedactedScheduleIds;
    const redactedScheduleIdsRef = useRef(
        new Set(authoritativeRedactedScheduleIds ?? [])
    );
    const tombstoneScheduleIdsRef = useRef(
        new Set(authoritativeRemovedScheduleIds ?? [])
    );
    const fullKnownAbsentScheduleIdsRef = useRef(new Set<string>());
    const onScheduleAccessRevokedRef = useRef(onScheduleAccessRevoked);
    onScheduleAccessRevokedRef.current = onScheduleAccessRevoked;
    const onScheduleAuthoritativelyRemovedRef = useRef(
        onScheduleAuthoritativelyRemoved
    );
    onScheduleAuthoritativelyRemovedRef.current =
        onScheduleAuthoritativelyRemoved;
    const onScheduleRestoredRef = useRef(onScheduleRestored);
    onScheduleRestoredRef.current = onScheduleRestored;
    const onFullSchedulesVerifiedRef = useRef(onFullSchedulesVerified);
    onFullSchedulesVerifiedRef.current = onFullSchedulesVerified;
    const onSessionAccessRejectedRef = useRef(onSessionAccessRejected);
    onSessionAccessRejectedRef.current = onSessionAccessRejected;
    const fallbackItemsRef = useRef(fallbackItems);
    fallbackItemsRef.current = fallbackItems;
    const fullScheduleItemsRef = useRef<ScheduleItem[]>([]);
    const hasFullScheduleSnapshotRef = useRef(false);
    const fallbackRevision = useMemo(
        () => getFallbackRevision(fallbackItems),
        [fallbackItems]
    );
    const observedFallbackRevisionRef = useRef(fallbackRevision);
    const removalRevision = useMemo(
        () => [...(authoritativeRemovedScheduleIds ?? [])].sort().join("|"),
        [authoritativeRemovedScheduleIds]
    );
    const observedRemovalRevisionRef = useRef(removalRevision);
    const redactionRevision = useMemo(
        () => [...(authoritativeRedactedScheduleIds ?? [])].sort().join("|"),
        [authoritativeRedactedScheduleIds]
    );
    const observedRedactionRevisionRef = useRef(redactionRevision);
    const retryStateRef = useRef<RetryState>({
        accountKey: "anonymous",
        fingerprint: null,
        consecutive: 0,
    });
    const [snapshot, setSnapshot] = useState<DepartureHomeSnapshot>(
        createInitialSnapshot
    );
    const snapshotRef = useRef(snapshot);
    snapshotRef.current = snapshot;

    const commitSnapshot = useCallback((next: DepartureHomeSnapshot) => {
        snapshotRef.current = next;
        setSnapshot(next);
    }, []);

    const getRetryDelay = useCallback((
        accountKey: string,
        fingerprint: string | null
    ): number | null => {
        const current = retryStateRef.current;
        if (current.accountKey !== accountKey || fingerprint === null) {
            retryStateRef.current = {
                accountKey,
                fingerprint,
                consecutive: fingerprint ? 1 : 0,
            };
        } else if (current.fingerprint === fingerprint) {
            retryStateRef.current = {
                ...current,
                consecutive: current.consecutive + 1,
            };
        } else {
            retryStateRef.current = {
                accountKey,
                fingerprint,
                consecutive: 1,
            };
        }

        const consecutive = retryStateRef.current.consecutive;
        if (!fingerprint || consecutive === 0) return null;
        return DEPARTURE_HOME_RETRY_BACKOFF_MS[
            Math.min(
                consecutive - 1,
                DEPARTURE_HOME_RETRY_BACKOFF_MS.length - 1
            )
        ];
    }, []);

    const refresh = useCallback(async () => {
        if (!focusedRef.current) return;
        const requestAuthEpoch = authEpochRef.current;
        if (
            !isAuthSessionEpochCurrent(requestAuthEpoch)
            || !isAuthSessionActive(requestAuthEpoch)
        ) {
            return;
        }

        activeControllerRef.current?.abort();
        const controller = new AbortController();
        activeControllerRef.current = controller;
        const requestSequence = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestSequence;
        const requestCollectionEpoch = collectionEpochRef.current;
        const isCurrent = () => (
            focusedRef.current
            && requestSequence === requestSequenceRef.current
            && requestAuthEpoch === authEpochRef.current
            && isAuthSessionEpochCurrent(requestAuthEpoch)
            && isAuthSessionActive(requestAuthEpoch)
            && requestCollectionEpoch === collectionEpochRef.current
            && !controller.signal.aborted
        );

        const currentSnapshot = snapshotRef.current;
        commitSnapshot({
            ...currentSnapshot,
            loading: true,
        });

        const requestedAt = new Date();
        const memberPromise = getAuthMember().catch(() => null);
        let sessionAccessRejected = false;
        const rejectSessionImmediately = () => {
            if (!isCurrent() || sessionAccessRejected) return;
            sessionAccessRejected = true;
            requestSequenceRef.current += 1;
            controller.abort();
            redactedScheduleIdsRef.current = new Set(
                authoritativeRedactedScheduleIdsRef.current ?? []
            );
            tombstoneScheduleIdsRef.current = new Set(
                authoritativeRemovedScheduleIdsRef.current ?? []
            );
            regrantVerificationCursorRef.current = {
                identity: null,
                offset: 0,
            };
            fullKnownAbsentScheduleIdsRef.current.clear();
            fullScheduleItemsRef.current = [];
            hasFullScheduleSnapshotRef.current = false;
            onSessionAccessRejectedRef.current?.();
            commitSnapshot({
                ...createInitialSnapshot(),
                source: "calendar-fallback",
                loading: false,
                connectionIssue: "error",
                refreshedAt: Date.now(),
                retryDelayMs: DEPARTURE_HOME_RETRY_BACKOFF_MS[
                    DEPARTURE_HOME_RETRY_BACKOFF_MS.length - 1
                ],
            });
        };
        const resetForMemberChange = (latestMemberId?: number) => {
            if (!isCurrent()) return;
            controller.abort();
            requestSequenceRef.current += 1;
            collectionEpochRef.current += 1;
            redactedScheduleIdsRef.current.clear();
            tombstoneScheduleIdsRef.current.clear();
            regrantVerificationCursorRef.current = {
                identity: null,
                offset: 0,
            };
            fullKnownAbsentScheduleIdsRef.current.clear();
            fullScheduleItemsRef.current = [];
            hasFullScheduleSnapshotRef.current = false;
            retryStateRef.current = {
                accountKey: String(latestMemberId ?? "anonymous"),
                fingerprint: null,
                consecutive: 0,
            };
            pendingRefreshRef.current = focusedRef.current;
            commitSnapshot({
                ...createInitialSnapshot(),
                source: "calendar-fallback",
                items: [],
                candidateItems: [],
                currentMemberId: latestMemberId,
                loading: false,
            });
        };

        let items: ScheduleItem[];
        try {
            items = await getSchedules({ signal: controller.signal });
        } catch (error) {
            if (getDetailAccessFailure(error) === "session") {
                rejectSessionImmediately();
                return;
            }
            const currentMemberId = getMemberId(await memberPromise);
            if (!isCurrent()) return;
            const latestMemberId = getMemberId(
                await getAuthMember().catch(() => null)
            );
            if (!isCurrent()) return;
            if (latestMemberId !== currentMemberId) {
                resetForMemberChange(latestMemberId);
                return;
            }

            const previous = snapshotRef.current;
            const sameAccount = previous.currentMemberId === currentMemberId;
            if (!sameAccount) {
                redactedScheduleIdsRef.current.clear();
                tombstoneScheduleIdsRef.current.clear();
                regrantVerificationCursorRef.current = {
                    identity: null,
                    offset: 0,
                };
                fullKnownAbsentScheduleIdsRef.current.clear();
                fullScheduleItemsRef.current = [];
                hasFullScheduleSnapshotRef.current = false;
            }
            const hiddenScheduleIds = new Set([
                ...redactedScheduleIdsRef.current,
                ...tombstoneScheduleIdsRef.current,
                ...fullKnownAbsentScheduleIdsRef.current,
            ]);
            const mergedItems = removeScheduleIdsFromItems(
                sameAccount && hasFullScheduleSnapshotRef.current
                    ? mergeScheduleItems(
                        fullScheduleItemsRef.current,
                        fallbackItemsRef.current
                    )
                    : fallbackItemsRef.current,
                hiddenScheduleIds
            );
            if (sameAccount && hasFullScheduleSnapshotRef.current) {
                fullScheduleItemsRef.current = mergedItems;
            }
            const statusesByScheduleId = sameAccount
                ? removeScheduleIdsFromRecord(
                    markStatusesStale(previous.statusesByScheduleId),
                    hiddenScheduleIds
                )
                : {};
            const issue = getDepartureHomeConnectionIssue(error);
            const candidateWindow = getDepartureCandidateWindow(
                mergedItems,
                requestedAt,
                currentMemberId
            );
            const partial: DepartureHomeSnapshot = {
                source: "calendar-fallback",
                items: mergedItems,
                candidateItems: candidateWindow.items,
                statusesByScheduleId,
                statusIssuesByScheduleId: {},
                detailIssuesByScheduleId: {},
                statusOrderingSafe: !candidateWindow.truncated,
                currentMemberId,
                loading: false,
                connectionIssue: issue,
                refreshedAt: Date.now(),
                retryDelayMs: null,
            };
            const fingerprint = getRetryFingerprint(partial, requestedAt);
            commitSnapshot({
                ...partial,
                retryDelayMs: getRetryDelay(
                    String(currentMemberId ?? "anonymous"),
                    fingerprint
                ),
            });
            return;
        }

        const storedMember = await memberPromise;
        const currentMemberId = getMemberId(storedMember);
        if (!isCurrent()) return;
        const confirmedMemberId = getMemberId(
            await getAuthMember().catch(() => null)
        );
        if (!isCurrent()) return;
        if (confirmedMemberId !== currentMemberId) {
            resetForMemberChange(confirmedMemberId);
            return;
        }
        onFullSchedulesVerifiedRef.current?.(items);
        if (!isCurrent()) return;

        const authoritativeItemsById = new Map(
            items.map((item) => [item.id, item])
        );
        const returnedScheduleIds = new Set(items.map((item) => item.id));
        const previouslyKnownScheduleIds = new Set([
            ...fullScheduleItemsRef.current.map((item) => item.id),
            ...fallbackItemsRef.current.map((item) => item.id),
            ...snapshotRef.current.items.map((item) => item.id),
        ]);
        const regrantWindow = selectRegrantVerificationItems(
            items,
            redactedScheduleIdsRef.current,
            tombstoneScheduleIdsRef.current,
            currentMemberId,
            regrantVerificationCursorRef.current
        );
        const regrantVerificationItems = regrantWindow.items;
        regrantVerificationCursorRef.current = regrantWindow.cursor;
        returnedScheduleIds.forEach((scheduleId) => {
            const restoredItem = authoritativeItemsById.get(scheduleId);
            const wasKnownAbsent =
                fullKnownAbsentScheduleIdsRef.current.has(scheduleId);
            fullKnownAbsentScheduleIdsRef.current.delete(scheduleId);
            if (
                wasKnownAbsent
                && restoredItem
                && !redactedScheduleIdsRef.current.has(scheduleId)
                && !tombstoneScheduleIdsRef.current.has(scheduleId)
                && isCurrent()
            ) {
                onScheduleRestoredRef.current?.(restoredItem);
            }
        });
        previouslyKnownScheduleIds.forEach((scheduleId) => {
            if (!returnedScheduleIds.has(scheduleId)) {
                const newlyAbsent =
                    !fullKnownAbsentScheduleIdsRef.current.has(scheduleId);
                fullKnownAbsentScheduleIdsRef.current.add(scheduleId);
                if (newlyAbsent && isCurrent()) {
                    onScheduleAuthoritativelyRemovedRef.current?.(scheduleId);
                }
            }
        });
        items = mergeScheduleItems(items, fallbackItemsRef.current);
        const displayHiddenScheduleIds = new Set([
            ...redactedScheduleIdsRef.current,
            ...tombstoneScheduleIdsRef.current,
            ...fullKnownAbsentScheduleIdsRef.current,
        ]);
        const verificationHiddenScheduleIds = new Set([
            ...redactedScheduleIdsRef.current,
            ...tombstoneScheduleIdsRef.current,
            ...fullKnownAbsentScheduleIdsRef.current,
        ]);
        const displayedItems = removeScheduleIdsFromItems(
            items,
            displayHiddenScheduleIds
        );
        const verificationSourceItems = removeScheduleIdsFromItems(
            items,
            verificationHiddenScheduleIds
        );
        const candidateWindow = getDepartureCandidateWindow(
            verificationSourceItems,
            requestedAt,
            currentMemberId
        );
        const verificationItems = candidateWindow.items;
        fullScheduleItemsRef.current = displayedItems;
        hasFullScheduleSnapshotRef.current = true;
        const preliminarySnapshot = snapshotRef.current;
        const preliminaryStatuses = preliminarySnapshot.currentMemberId
            === currentMemberId
            ? removeScheduleIdsFromRecord(
                preliminarySnapshot.statusesByScheduleId,
                displayHiddenScheduleIds
            )
            : {};
        commitSnapshot({
            source: "schedules",
            items: displayedItems,
            candidateItems: verificationItems.filter(
                (item) => !displayHiddenScheduleIds.has(item.id)
            ),
            statusesByScheduleId: preliminaryStatuses,
            statusIssuesByScheduleId: {},
            detailIssuesByScheduleId: {},
            statusOrderingSafe: !candidateWindow.truncated,
            currentMemberId,
            loading: true,
            connectionIssue: null,
            refreshedAt: preliminarySnapshot.refreshedAt,
            retryDelayMs: null,
        });
        if (!isCurrent()) return;

        const requests: CandidateRequest[] = verificationItems.flatMap((item) => [
            { kind: "detail" as const, item },
            { kind: "status" as const, item },
        ]).concat(regrantVerificationItems.map((item) => ({
            kind: "detail" as const,
            item,
            regrant: true,
        })));
        const previous = snapshotRef.current;
        const previousStatuses = previous.currentMemberId === currentMemberId
            ? previous.statusesByScheduleId
            : {};
        const detailsByScheduleId: Record<string, ScheduleItem | undefined> = {};
        const statusesByScheduleId: Record<
            string,
            ScheduleDepartureStatus | undefined
        > = {};
        const statusIssuesByScheduleId: Record<
            string,
            DepartureHomeConnectionIssue | undefined
        > = {};
        const detailIssuesByScheduleId: Record<
            string,
            DepartureHomeDetailIssue | undefined
        > = {};
        const excludedScheduleIds = new Set<string>();
        const verifiedRegrantScheduleIds = new Set<string>();

        const redactScheduleImmediately = (scheduleId: string) => {
            if (!isCurrent()) return;
            const shouldNotify = !redactedScheduleIdsRef.current.has(scheduleId);
            redactedScheduleIdsRef.current.add(scheduleId);
            fullScheduleItemsRef.current = removeScheduleIdsFromItems(
                fullScheduleItemsRef.current,
                new Set([scheduleId])
            );

            const current = snapshotRef.current;
            commitSnapshot({
                ...current,
                items: current.items.filter((item) => item.id !== scheduleId),
                candidateItems: current.candidateItems.filter(
                    (item) => item.id !== scheduleId
                ),
                statusesByScheduleId: removeScheduleIdsFromRecord(
                    current.statusesByScheduleId,
                    new Set([scheduleId])
                ),
                statusIssuesByScheduleId: removeScheduleIdsFromRecord(
                    current.statusIssuesByScheduleId,
                    new Set([scheduleId])
                ),
                detailIssuesByScheduleId: removeScheduleIdsFromRecord(
                    current.detailIssuesByScheduleId,
                    new Set([scheduleId])
                ),
            });
            if (shouldNotify && isCurrent()) {
                onScheduleAccessRevokedRef.current?.(scheduleId);
            }
        };

        const results = await mapWithConcurrency(
            requests,
            DEPARTURE_HOME_REQUEST_CONCURRENCY,
            controller.signal,
            isCurrent,
            async (request): Promise<CandidateRequestResult> => {
                if (!isCurrent()) return request;
                try {
                    const value = request.kind === "detail"
                        ? await getScheduleForDepartureHome(
                            request.item.id,
                            { signal: controller.signal }
                        )
                        : await getScheduleDepartureStatus(
                            request.item.id,
                            { signal: controller.signal }
                        );
                    return { ...request, value };
                } catch (error) {
                    if (request.kind === "detail") {
                        const accessFailure = getDetailAccessFailure(error);
                        if (accessFailure === "session") {
                            rejectSessionImmediately();
                        } else if (accessFailure === "schedule") {
                            redactScheduleImmediately(request.item.id);
                        }
                    } else if (
                        getDetailAccessFailure(error) === "session"
                    ) {
                        rejectSessionImmediately();
                    }
                    return { ...request, error };
                }
            }
        );
        if (!isCurrent()) return;

        const latestMemberId = getMemberId(
            await getAuthMember().catch(() => null)
        );
        if (!isCurrent()) return;
        if (latestMemberId !== currentMemberId) {
            resetForMemberChange(latestMemberId);
            return;
        }

        results.forEach((result) => {
            const scheduleId = result.item.id;
            if (result.kind === "detail") {
                if (result.value) {
                    const detail = result.value as ScheduleItem;
                    if (detail.id === scheduleId) {
                        detailsByScheduleId[scheduleId] = detail;
                        if (result.regrant) {
                            verifiedRegrantScheduleIds.add(scheduleId);
                        }
                    } else {
                        detailIssuesByScheduleId[scheduleId] = "verification";
                        excludedScheduleIds.add(scheduleId);
                    }
                } else if (result.error) {
                    const accessFailure = getDetailAccessFailure(result.error);
                    if (accessFailure === "session") {
                        detailIssuesByScheduleId[scheduleId] = "verification";
                    } else if (accessFailure === "schedule") {
                        detailIssuesByScheduleId[scheduleId] = "verification";
                        excludedScheduleIds.add(scheduleId);
                    } else {
                        detailIssuesByScheduleId[scheduleId] =
                            getDepartureHomeConnectionIssue(result.error);
                    }
                }
                return;
            }

            if (result.value) {
                statusesByScheduleId[scheduleId] =
                    result.value as ScheduleDepartureStatus;
                return;
            }
            if (result.error && !isRolloutUnavailable(result.error)) {
                statusIssuesByScheduleId[scheduleId] = mergeConnectionIssue(
                    statusIssuesByScheduleId[scheduleId],
                    getDepartureHomeConnectionIssue(result.error)
                );
                const previousStatus = previousStatuses[scheduleId];
                if (previousStatus) {
                    statusesByScheduleId[scheduleId] = {
                        ...previousStatus,
                        stale: true,
                    };
                }
            }
        });

        verifiedRegrantScheduleIds.forEach((scheduleId) => {
            const restoredItem = detailsByScheduleId[scheduleId];
            if (
                restoredItem
                && redactedScheduleIdsRef.current.has(scheduleId)
                && !tombstoneScheduleIdsRef.current.has(scheduleId)
                && isCurrent()
            ) {
                redactedScheduleIdsRef.current.delete(scheduleId);
                onScheduleRestoredRef.current?.(restoredItem);
            }
        });
        const hiddenScheduleIds = new Set([
            ...redactedScheduleIdsRef.current,
            ...tombstoneScheduleIdsRef.current,
            ...fullKnownAbsentScheduleIdsRef.current,
            ...excludedScheduleIds,
        ]);
        if (!isCurrent()) return;

        const verifiedAllItems = items
            .map((item) => detailsByScheduleId[item.id] ?? item)
            .filter((item) => !hiddenScheduleIds.has(item.id));
        fullScheduleItemsRef.current = verifiedAllItems;
        hasFullScheduleSnapshotRef.current = true;
        const finalCandidateWindow = getDepartureCandidateWindow(
            verifiedAllItems,
            requestedAt,
            currentMemberId
        );
        const verifiedCandidateItems = finalCandidateWindow.items;
        const visibleStatusesByScheduleId = removeScheduleIdsFromRecord(
            statusesByScheduleId,
            hiddenScheduleIds
        );
        const visibleStatusIssuesByScheduleId = removeScheduleIdsFromRecord(
            statusIssuesByScheduleId,
            hiddenScheduleIds
        );
        const visibleDetailIssuesByScheduleId = removeScheduleIdsFromRecord(
            detailIssuesByScheduleId,
            hiddenScheduleIds
        );
        const partial: DepartureHomeSnapshot = {
            source: "schedules",
            items: verifiedAllItems,
            candidateItems: verifiedCandidateItems,
            statusesByScheduleId: visibleStatusesByScheduleId,
            statusIssuesByScheduleId: visibleStatusIssuesByScheduleId,
            detailIssuesByScheduleId: visibleDetailIssuesByScheduleId,
            statusOrderingSafe:
                !finalCandidateWindow.truncated
                && verifiedRegrantScheduleIds.size === 0,
            currentMemberId,
            loading: false,
            connectionIssue: null,
            refreshedAt: Date.now(),
            retryDelayMs: null,
        };
        const fingerprint = getRetryFingerprint(partial, new Date());
        commitSnapshot({
            ...partial,
            retryDelayMs: getRetryDelay(
                String(currentMemberId ?? "anonymous"),
                fingerprint
            ),
        });
    }, [commitSnapshot, getRetryDelay]);

    useEffect(() => {
        focusedRef.current = focused;
        if (!focused) {
            requestSequenceRef.current += 1;
            activeControllerRef.current?.abort();
            activeControllerRef.current = null;
            pendingRefreshRef.current = false;
            return undefined;
        }

        const current = snapshotRef.current;
        if (current.refreshedAt !== null || current.items.length > 0) {
            const hiddenScheduleIds = new Set([
                ...redactedScheduleIdsRef.current,
                ...tombstoneScheduleIdsRef.current,
                ...fullKnownAbsentScheduleIdsRef.current,
            ]);
            const mergedItems = removeScheduleIdsFromItems(
                mergeScheduleItems(
                    hasFullScheduleSnapshotRef.current
                        ? fullScheduleItemsRef.current
                        : current.items,
                    fallbackItemsRef.current
                ),
                hiddenScheduleIds
            );
            if (hasFullScheduleSnapshotRef.current) {
                fullScheduleItemsRef.current = mergedItems;
            }
            const candidateWindow = getDepartureCandidateWindow(
                mergedItems,
                new Date(),
                current.currentMemberId
            );
            commitSnapshot({
                ...current,
                items: mergedItems,
                candidateItems: candidateWindow.items,
                statusOrderingSafe: !candidateWindow.truncated,
                loading: false,
                statusesByScheduleId: removeScheduleIdsFromRecord(
                    current.statusesByScheduleId,
                    hiddenScheduleIds
                ),
                statusIssuesByScheduleId: removeScheduleIdsFromRecord(
                    current.statusIssuesByScheduleId,
                    hiddenScheduleIds
                ),
                detailIssuesByScheduleId: removeScheduleIdsFromRecord(
                    current.detailIssuesByScheduleId,
                    hiddenScheduleIds
                ),
            });
        }
        refresh();
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") refresh();
        });
        return () => {
            focusedRef.current = false;
            requestSequenceRef.current += 1;
            activeControllerRef.current?.abort();
            activeControllerRef.current = null;
            subscription?.remove();
        };
    }, [commitSnapshot, focused, refresh]);

    useEffect(() => subscribeAuthSessionEpoch((nextAuthEpoch) => {
        if (authEpochRef.current === nextAuthEpoch) return;
        // The shared auth generation is the security boundary for every
        // callback and request. Abort old-account work synchronously, before
        // authStorage cleanup or the next React render can be delayed.
        authEpochRef.current = nextAuthEpoch;
        requestSequenceRef.current += 1;
        collectionEpochRef.current += 1;
        activeControllerRef.current?.abort();
        activeControllerRef.current = null;
        pendingRefreshRef.current = false;
        redactedScheduleIdsRef.current.clear();
        tombstoneScheduleIdsRef.current.clear();
        regrantVerificationCursorRef.current = {
            identity: null,
            offset: 0,
        };
        fullKnownAbsentScheduleIdsRef.current.clear();
        fullScheduleItemsRef.current = [];
        hasFullScheduleSnapshotRef.current = false;
        retryStateRef.current = {
            accountKey: "anonymous",
            fingerprint: null,
            consecutive: 0,
        };
        commitSnapshot({
            ...createInitialSnapshot(),
            source: "calendar-fallback",
            loading: false,
        });
    }), [commitSnapshot]);

    useEffect(() => subscribeScheduleDepartureMutation((event) => {
        const activeAuthEpoch = authEpochRef.current;
        if (
            event.authEpoch !== activeAuthEpoch
            || !isAuthSessionActive(activeAuthEpoch)
        ) {
            return;
        }
        const hiddenScheduleIds = new Set([
            ...redactedScheduleIdsRef.current,
            ...tombstoneScheduleIdsRef.current,
            ...fullKnownAbsentScheduleIdsRef.current,
        ]);
        if (hiddenScheduleIds.has(event.scheduleId)) return;

        const current = snapshotRef.current;
        const itemIsVisible = current.items.some(
            (item) => item.id === event.scheduleId
        );
        if (!itemIsVisible) return;

        // An action response is newer and more authoritative than any GET that
        // was already in flight. Invalidate that refresh before applying it.
        requestSequenceRef.current += 1;
        collectionEpochRef.current += 1;
        activeControllerRef.current?.abort();
        activeControllerRef.current = null;

        const authoritativeItem = event.item?.id === event.scheduleId
            ? event.item
            : undefined;
        const replaceItem = (items: ScheduleItem[]) => authoritativeItem
            ? items.map((item) => (
                item.id === event.scheduleId ? authoritativeItem : item
            ))
            : items;
        const nextItems = replaceItem(current.items);
        const nextFullItems = replaceItem(fullScheduleItemsRef.current);
        if (authoritativeItem && hasFullScheduleSnapshotRef.current) {
            fullScheduleItemsRef.current = nextFullItems;
        }

        const nextStatuses = {
            ...current.statusesByScheduleId,
        };
        if (
            event.status
            && event.status.scheduleId === event.scheduleId
        ) {
            nextStatuses[event.scheduleId] = event.status;
        } else if (nextStatuses[event.scheduleId]) {
            nextStatuses[event.scheduleId] = {
                ...nextStatuses[event.scheduleId]!,
                stale: true,
            };
        }
        const candidateWindow = getDepartureCandidateWindow(
            nextItems,
            new Date(),
            current.currentMemberId
        );
        pendingRefreshRef.current =
            event.refreshing === true || event.status === undefined;
        commitSnapshot({
            ...current,
            items: nextItems,
            candidateItems: candidateWindow.items,
            statusesByScheduleId: nextStatuses,
            statusOrderingSafe:
                current.statusOrderingSafe && !candidateWindow.truncated,
            loading: false,
        });
    }), [commitSnapshot]);

    useEffect(() => {
        if (!focused || snapshot.loading || snapshot.refreshedAt === null) return;
        const timer = setTimeout(
            refresh,
            getRefreshDelay(snapshot, Date.now())
        );
        return () => clearTimeout(timer);
    }, [focused, refresh, snapshot]);

    useEffect(() => {
        const fallbackChanged =
            observedFallbackRevisionRef.current !== fallbackRevision;
        const removalsChanged =
            observedRemovalRevisionRef.current !== removalRevision;
        const redactionsChanged =
            observedRedactionRevisionRef.current !== redactionRevision;
        if (!fallbackChanged && !removalsChanged && !redactionsChanged) return;
        observedFallbackRevisionRef.current = fallbackRevision;
        observedRemovalRevisionRef.current = removalRevision;
        observedRedactionRevisionRef.current = redactionRevision;
        if (removalsChanged) {
            tombstoneScheduleIdsRef.current = new Set(
                authoritativeRemovedScheduleIds ?? []
            );
        }
        if (redactionsChanged) {
            redactedScheduleIdsRef.current = new Set(
                authoritativeRedactedScheduleIds ?? []
            );
        }
        if (removalsChanged || redactionsChanged) {
            regrantVerificationCursorRef.current = {
                identity: null,
                offset: 0,
            };
        }
        collectionEpochRef.current += 1;
        requestSequenceRef.current += 1;
        activeControllerRef.current?.abort();
        activeControllerRef.current = null;
        pendingRefreshRef.current = false;
        if (!focused) return;

        const current = snapshotRef.current;
        const hiddenScheduleIds = new Set([
            ...redactedScheduleIdsRef.current,
            ...tombstoneScheduleIdsRef.current,
            ...fullKnownAbsentScheduleIdsRef.current,
        ]);
        const mergedItems = removeScheduleIdsFromItems(
            mergeScheduleItems(
                hasFullScheduleSnapshotRef.current
                    ? fullScheduleItemsRef.current
                    : current.items,
                fallbackItemsRef.current
            ),
            hiddenScheduleIds
        );
        if (hasFullScheduleSnapshotRef.current) {
            fullScheduleItemsRef.current = mergedItems;
        }
        const candidateWindow = getDepartureCandidateWindow(
            mergedItems,
            new Date(),
            current.currentMemberId
        );
        commitSnapshot({
            ...current,
            source: current.source === "loading"
                ? "calendar-fallback"
                : current.source,
            items: mergedItems,
            candidateItems: candidateWindow.items,
            statusOrderingSafe: !candidateWindow.truncated,
            loading: false,
            statusesByScheduleId: removeScheduleIdsFromRecord(
                current.statusesByScheduleId,
                hiddenScheduleIds
            ),
            statusIssuesByScheduleId: removeScheduleIdsFromRecord(
                current.statusIssuesByScheduleId,
                hiddenScheduleIds
            ),
            detailIssuesByScheduleId: removeScheduleIdsFromRecord(
                current.detailIssuesByScheduleId,
                hiddenScheduleIds
            ),
        });
        refresh();
    }, [
        authoritativeRedactedScheduleIds,
        authoritativeRemovedScheduleIds,
        commitSnapshot,
        fallbackRevision,
        focused,
        redactionRevision,
        refresh,
        removalRevision,
    ]);

    useEffect(() => {
        if (!focused || snapshot.loading || !pendingRefreshRef.current) return;
        pendingRefreshRef.current = false;
        refresh();
    }, [focused, refresh, snapshot.loading]);

    return useMemo(() => ({
        ...snapshot,
        refresh,
    }), [refresh, snapshot]);
}

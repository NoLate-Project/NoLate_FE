import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import {
    getScheduleDepartureStatus,
    getScheduleForDepartureHome,
    getSchedules,
    type ScheduleDepartureStatus,
} from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import {
    getAuthMember,
    subscribeAuthInvalidation,
} from "../auth/authStorage";
import type { ScheduleItem } from "./types";
import {
    getDepartureStatusRefreshAt,
    getDepartureVerificationItems,
    isDepartureCandidateEligible,
    isDepartureStatusFresh,
    NEXT_DEPARTURE_STATUS_MAX_AGE_MS,
} from "./nextDeparture";

export const DEPARTURE_HOME_REQUEST_CONCURRENCY = 4;
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
    currentMemberId?: number;
    loading: boolean;
    connectionIssue: DepartureHomeConnectionIssue | null;
    refreshedAt: number | null;
    retryDelayMs: number | null;
};

type CandidateRequest =
    | { kind: "detail"; item: ScheduleItem }
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

function isAuthoritativeDetailFailure(error: unknown): boolean {
    return error instanceof ApiResponseError
        && error.status !== undefined
        && [400, 401, 403, 404, 410, 422].includes(error.status);
}

function mergeConnectionIssue(
    current: DepartureHomeConnectionIssue | undefined,
    next: DepartureHomeConnectionIssue
): DepartureHomeConnectionIssue {
    return current === "offline" || next === "offline" ? "offline" : "error";
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

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (!signal.aborted && isCurrent() && nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            if (signal.aborted || !isCurrent()) return;
            results[index] = await mapper(values[index]!);
        }
    }));

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
                status.evaluatedAt ?? "",
                status.liveFetchedAt ?? "",
                status.nextCheckAt ?? "",
                status.failureReason ?? "",
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
        loading: true,
        connectionIssue: null,
        refreshedAt: null,
        retryDelayMs: null,
    };
}

export function useNextDepartureHome({
    fallbackItems,
    focused,
}: {
    fallbackItems: ScheduleItem[];
    focused: boolean;
}) {
    const requestSequenceRef = useRef(0);
    const activeControllerRef = useRef<AbortController | null>(null);
    const focusedRef = useRef(focused);
    const pendingRefreshRef = useRef(false);
    const fallbackItemsRef = useRef(fallbackItems);
    fallbackItemsRef.current = fallbackItems;
    const fallbackRevision = useMemo(
        () => getFallbackRevision(fallbackItems),
        [fallbackItems]
    );
    const observedFallbackRevisionRef = useRef(fallbackRevision);
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

        activeControllerRef.current?.abort();
        const controller = new AbortController();
        activeControllerRef.current = controller;
        const requestSequence = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestSequence;
        const isCurrent = () => (
            focusedRef.current
            && requestSequence === requestSequenceRef.current
            && !controller.signal.aborted
        );

        const currentSnapshot = snapshotRef.current;
        commitSnapshot({
            ...currentSnapshot,
            loading: true,
        });

        const requestedAt = new Date();
        const memberPromise = getAuthMember().catch(() => null);

        let items: ScheduleItem[];
        try {
            items = await getSchedules({ signal: controller.signal });
        } catch (error) {
            const currentMemberId = getMemberId(await memberPromise);
            if (!isCurrent()) return;

            const previous = snapshotRef.current;
            const sameAccount = previous.currentMemberId === currentMemberId;
            const mergedItems = sameAccount && previous.source === "schedules"
                ? mergeScheduleItems(previous.items, fallbackItemsRef.current)
                : fallbackItemsRef.current;
            const statusesByScheduleId = sameAccount
                ? markStatusesStale(previous.statusesByScheduleId)
                : {};
            const issue = getDepartureHomeConnectionIssue(error);
            const partial: DepartureHomeSnapshot = {
                source: "calendar-fallback",
                items: mergedItems,
                candidateItems: getDepartureVerificationItems(
                    mergedItems,
                    requestedAt,
                    currentMemberId
                ),
                statusesByScheduleId,
                statusIssuesByScheduleId: {},
                detailIssuesByScheduleId: {},
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

        const verificationItems = getDepartureVerificationItems(
            items,
            requestedAt,
            currentMemberId
        );
        const requests: CandidateRequest[] = verificationItems.flatMap((item) => [
            { kind: "detail" as const, item },
            { kind: "status" as const, item },
        ]);
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
            controller.abort();
            requestSequenceRef.current += 1;
            retryStateRef.current = {
                accountKey: String(latestMemberId ?? "anonymous"),
                fingerprint: null,
                consecutive: 0,
            };
            pendingRefreshRef.current = focusedRef.current;
            commitSnapshot({
                ...createInitialSnapshot(),
                source: "calendar-fallback",
                items: fallbackItemsRef.current,
                candidateItems: getDepartureVerificationItems(
                    fallbackItemsRef.current,
                    requestedAt,
                    latestMemberId
                ),
                currentMemberId: latestMemberId,
                loading: false,
            });
            return;
        }

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

        results.forEach((result) => {
            const scheduleId = result.item.id;
            if (result.kind === "detail") {
                if (result.value) {
                    const detail = result.value as ScheduleItem;
                    if (detail.id === scheduleId) {
                        detailsByScheduleId[scheduleId] = detail;
                    } else {
                        detailIssuesByScheduleId[scheduleId] = "verification";
                        excludedScheduleIds.add(scheduleId);
                    }
                } else if (result.error) {
                    if (isAuthoritativeDetailFailure(result.error)) {
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

        const verifiedAllItems = items.map(
            (item) => detailsByScheduleId[item.id] ?? item
        );
        const verifiedCandidateItems = verificationItems
            .filter((item) => !excludedScheduleIds.has(item.id))
            .map((item) => detailsByScheduleId[item.id] ?? item)
            .filter((item) => isDepartureCandidateEligible(
                item,
                requestedAt.getTime(),
                currentMemberId
            ));
        const partial: DepartureHomeSnapshot = {
            source: "schedules",
            items: verifiedAllItems,
            candidateItems: verifiedCandidateItems,
            statusesByScheduleId,
            statusIssuesByScheduleId,
            detailIssuesByScheduleId,
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
    }, [focused, refresh]);

    useEffect(() => subscribeAuthInvalidation(() => {
        requestSequenceRef.current += 1;
        activeControllerRef.current?.abort();
        activeControllerRef.current = null;
        pendingRefreshRef.current = false;
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

    useEffect(() => {
        if (!focused || snapshot.loading || snapshot.refreshedAt === null) return;
        const timer = setTimeout(
            refresh,
            getRefreshDelay(snapshot, Date.now())
        );
        return () => clearTimeout(timer);
    }, [focused, refresh, snapshot]);

    useEffect(() => {
        if (observedFallbackRevisionRef.current === fallbackRevision) return;
        observedFallbackRevisionRef.current = fallbackRevision;
        if (!focused) return;
        if (snapshot.loading) {
            pendingRefreshRef.current = true;
            return;
        }

        const current = snapshotRef.current;
        const mergedItems = mergeScheduleItems(
            current.items,
            fallbackItemsRef.current
        );
        commitSnapshot({
            ...current,
            items: mergedItems,
            candidateItems: getDepartureVerificationItems(
                mergedItems,
                new Date(),
                current.currentMemberId
            ),
        });
        refresh();
    }, [
        commitSnapshot,
        fallbackRevision,
        focused,
        refresh,
        snapshot.loading,
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

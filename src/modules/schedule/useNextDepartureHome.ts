import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import {
    getDepartureReadySchedules,
    getSchedule,
    getScheduleDepartureStatus,
    type ScheduleDepartureStatus,
} from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import type { ScheduleItem } from "./types";
import {
    getDepartureStatusRefreshAt,
    getDepartureVerificationItems,
    NEXT_DEPARTURE_STATUS_MAX_AGE_MS,
} from "./nextDeparture";

export const DEPARTURE_HOME_LOOKBACK_MS = 24 * 60 * 60_000;
export const DEPARTURE_HOME_LOOKAHEAD_MS = 14 * 24 * 60 * 60_000;
export const DEPARTURE_HOME_REQUEST_CONCURRENCY = 4;
const DEPARTURE_HOME_RETRY_MS = 60_000;
const DEPARTURE_HOME_MIN_REFRESH_DELAY_MS = 15_000;

type DepartureHomeSource = "loading" | "departures" | "calendar-fallback";
export type DepartureHomeConnectionIssue = "offline" | "error";

type DepartureHomeSnapshot = {
    source: DepartureHomeSource;
    items: ScheduleItem[];
    statusesByScheduleId: Record<string, ScheduleDepartureStatus | undefined>;
    statusIssuesByScheduleId: Record<
        string,
        DepartureHomeConnectionIssue | undefined
    >;
    currentMemberId?: number;
    loading: boolean;
    connectionIssue: DepartureHomeConnectionIssue | null;
    refreshedAt: number | null;
};

type CandidateRequest =
    | { kind: "detail"; item: ScheduleItem }
    | { kind: "status"; item: ScheduleItem };

type CandidateRequestResult = CandidateRequest & {
    value?: ScheduleItem | ScheduleDepartureStatus;
    error?: unknown;
};

function getConnectionIssue(error: unknown): DepartureHomeConnectionIssue {
    const message = error instanceof Error ? error.message : String(error);
    return /network|timeout|offline|connection|internet/i.test(message)
        ? "offline"
        : "error";
}

function isRolloutUnavailable(error: unknown): boolean {
    return error instanceof ApiResponseError
        && (error.status === 404 || error.status === 501);
}

function mergeConnectionIssue(
    current: DepartureHomeConnectionIssue | undefined,
    next: DepartureHomeConnectionIssue
): DepartureHomeConnectionIssue {
    return current === "offline" || next === "offline" ? "offline" : "error";
}

export function getDepartureHomeRange(now: Date): {
    fromAt: string;
    toAt: string;
} {
    return {
        fromAt: new Date(now.getTime() - DEPARTURE_HOME_LOOKBACK_MS).toISOString(),
        toAt: new Date(now.getTime() + DEPARTURE_HOME_LOOKAHEAD_MS).toISOString(),
    };
}

async function mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), values.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(values[index]!);
        }
    }));

    return results;
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
            item.travelMinutes ?? "",
            item.travelCollaborationEnabled ?? "",
            item.routeSetupRequired ?? "",
            item.notificationEnabled ?? "",
            item.locationName ?? "",
            item.destination?.name ?? "",
            item.destination?.address ?? "",
            item.route ? "route" : "",
            item.myTravelPlan?.updatedAt ?? "",
            item.myTravelPlan?.departAt ?? "",
            item.myTravelPlan?.status ?? "",
        ].join("|"))
        .join(";");
}

function getRefreshDelay(snapshot: DepartureHomeSnapshot, now: number): number {
    const hasIssue = snapshot.connectionIssue !== null
        || Object.keys(snapshot.statusIssuesByScheduleId).length > 0;
    const fallbackTarget = (snapshot.refreshedAt ?? now)
        + (hasIssue ? DEPARTURE_HOME_RETRY_MS : NEXT_DEPARTURE_STATUS_MAX_AGE_MS);
    const statusTargets = Object.values(snapshot.statusesByScheduleId)
        .filter((status): status is ScheduleDepartureStatus => Boolean(status))
        .map((status) => getDepartureStatusRefreshAt(status, new Date(now)));
    const target = Math.min(fallbackTarget, ...statusTargets);
    return Math.min(
        NEXT_DEPARTURE_STATUS_MAX_AGE_MS,
        Math.max(DEPARTURE_HOME_MIN_REFRESH_DELAY_MS, target - now)
    );
}

export function useNextDepartureHome({
    fallbackItems,
    focused,
}: {
    fallbackItems: ScheduleItem[];
    focused: boolean;
}) {
    const requestSequenceRef = useRef(0);
    const pendingFallbackRefreshRef = useRef(false);
    const fallbackRevision = useMemo(
        () => getFallbackRevision(fallbackItems),
        [fallbackItems]
    );
    const observedFallbackRevisionRef = useRef(fallbackRevision);
    const [snapshot, setSnapshot] = useState<DepartureHomeSnapshot>({
        source: "loading",
        items: [],
        statusesByScheduleId: {},
        statusIssuesByScheduleId: {},
        loading: true,
        connectionIssue: null,
        refreshedAt: null,
    });

    const refresh = useCallback(async () => {
        const requestSequence = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestSequence;
        setSnapshot((current) => ({
            ...current,
            loading: true,
            statusesByScheduleId: Object.fromEntries(
                Object.entries(current.statusesByScheduleId).map(
                    ([scheduleId, status]) => [
                        scheduleId,
                        status ? { ...status, stale: true } : status,
                    ]
                )
            ),
        }));

        const requestedAt = new Date();
        const range = getDepartureHomeRange(requestedAt);
        const memberPromise = getAuthMember().catch(() => null);

        let items: ScheduleItem[];
        try {
            items = await getDepartureReadySchedules(range.fromAt, range.toAt);
        } catch (error) {
            if (requestSequence !== requestSequenceRef.current) return;
            const issue = getConnectionIssue(error);
            setSnapshot((current) => ({
                ...current,
                source: current.source === "departures"
                    ? "departures"
                    : "calendar-fallback",
                items: current.source === "departures" ? current.items : [],
                loading: false,
                connectionIssue: issue,
                refreshedAt: Date.now(),
            }));
            return;
        }

        const storedMember = await memberPromise;
        const currentMemberId = Number.isSafeInteger(storedMember?.id)
            ? storedMember?.id
            : undefined;
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
            async (request): Promise<CandidateRequestResult> => {
                try {
                    const value = request.kind === "detail"
                        ? await getSchedule(request.item.id)
                        : await getScheduleDepartureStatus(request.item.id);
                    return { ...request, value };
                } catch (error) {
                    return { ...request, error };
                }
            }
        );
        if (requestSequence !== requestSequenceRef.current) return;

        const detailsByScheduleId: Record<string, ScheduleItem | undefined> = {};
        const statusesByScheduleId: Record<
            string,
            ScheduleDepartureStatus | undefined
        > = {};
        const statusIssuesByScheduleId: Record<
            string,
            DepartureHomeConnectionIssue | undefined
        > = {};

        results.forEach((result) => {
            const scheduleId = result.item.id;
            if (result.kind === "detail") {
                if (result.value) {
                    const detail = result.value as ScheduleItem;
                    if (detail.id === scheduleId) {
                        detailsByScheduleId[scheduleId] = detail;
                    } else {
                        statusIssuesByScheduleId[scheduleId] = "error";
                    }
                } else if (result.error) {
                    statusIssuesByScheduleId[scheduleId] = mergeConnectionIssue(
                        statusIssuesByScheduleId[scheduleId],
                        getConnectionIssue(result.error)
                    );
                }
                return;
            }

            if (result.value) {
                const departureStatus = result.value as ScheduleDepartureStatus;
                statusesByScheduleId[scheduleId] = departureStatus;
                return;
            }
            if (result.error && !isRolloutUnavailable(result.error)) {
                statusIssuesByScheduleId[scheduleId] = mergeConnectionIssue(
                    statusIssuesByScheduleId[scheduleId],
                    getConnectionIssue(result.error)
                );
            }
        });

        const verifiedItems = verificationItems.map((item) => {
            const detail = detailsByScheduleId[item.id];
            if (!detail) return item;
            return {
                ...item,
                ...detail,
                route: detail.route ?? item.route,
                myTravelPlan: detail.myTravelPlan ?? item.myTravelPlan,
            };
        });
        setSnapshot({
            source: "departures",
            items: verifiedItems,
            statusesByScheduleId,
            statusIssuesByScheduleId,
            currentMemberId,
            loading: false,
            connectionIssue: null,
            refreshedAt: Date.now(),
        });
    }, []);

    useEffect(() => {
        if (!focused) {
            requestSequenceRef.current += 1;
            pendingFallbackRefreshRef.current = false;
            return undefined;
        }

        refresh();
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") refresh();
        });
        return () => {
            requestSequenceRef.current += 1;
            subscription?.remove();
        };
    }, [focused, refresh]);

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
            pendingFallbackRefreshRef.current = true;
            return;
        }
        refresh();
    }, [fallbackRevision, focused, refresh, snapshot.loading]);

    useEffect(() => {
        if (
            !focused
            || snapshot.loading
            || !pendingFallbackRefreshRef.current
        ) return;
        pendingFallbackRefreshRef.current = false;
        refresh();
    }, [focused, refresh, snapshot.loading]);

    const effectiveItems = snapshot.source === "calendar-fallback"
        || snapshot.source === "loading"
        ? fallbackItems
        : snapshot.items;

    return useMemo(() => ({
        ...snapshot,
        items: effectiveItems,
        refresh,
    }), [effectiveItems, refresh, snapshot]);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import {
    getDepartureReadySchedules,
    getScheduleDepartureStatus,
    type ScheduleDepartureStatus,
} from "../../api/schedule";
import type { ScheduleItem } from "./types";
import { rankNextDepartures } from "./nextDeparture";

const DEPARTURE_STATUS_PREFETCH_LIMIT = 6;

type DepartureHomeSource = "loading" | "departures" | "calendar-fallback";

type DepartureHomeSnapshot = {
    source: DepartureHomeSource;
    items: ScheduleItem[];
    statusesByScheduleId: Record<string, ScheduleDepartureStatus | undefined>;
    loading: boolean;
    connectionIssue: "offline" | "error" | null;
};

function getConnectionIssue(error: unknown): "offline" | "error" {
    const message = error instanceof Error ? error.message : String(error);
    return /network|timeout|offline|connection|internet/i.test(message)
        ? "offline"
        : "error";
}

export function useNextDepartureHome({
    fallbackItems,
    focused,
}: {
    fallbackItems: ScheduleItem[];
    focused: boolean;
}) {
    const requestSequenceRef = useRef(0);
    const [snapshot, setSnapshot] = useState<DepartureHomeSnapshot>({
        source: "loading",
        items: [],
        statusesByScheduleId: {},
        loading: true,
        connectionIssue: null,
    });

    const refresh = useCallback(async () => {
        const requestSequence = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestSequence;
        setSnapshot((current) => ({
            ...current,
            loading: true,
        }));

        let items: ScheduleItem[];
        try {
            items = await getDepartureReadySchedules();
        } catch (error) {
            if (requestSequence !== requestSequenceRef.current) return;
            setSnapshot({
                source: "calendar-fallback",
                items: [],
                statusesByScheduleId: {},
                loading: false,
                connectionIssue: getConnectionIssue(error),
            });
            return;
        }

        if (requestSequence !== requestSequenceRef.current) return;
        setSnapshot({
            source: "departures",
            items,
            statusesByScheduleId: {},
            loading: false,
            connectionIssue: null,
        });

        const candidates = rankNextDepartures(items, {}, new Date())
            .slice(0, DEPARTURE_STATUS_PREFETCH_LIMIT);
        if (candidates.length === 0) return;

        const results = await Promise.allSettled(
            candidates.map(({ item }) => getScheduleDepartureStatus(item.id))
        );
        if (requestSequence !== requestSequenceRef.current) return;
        const statusesByScheduleId = results.reduce<
            Record<string, ScheduleDepartureStatus | undefined>
        >((statuses, result) => {
            if (result.status === "fulfilled") {
                statuses[result.value.scheduleId] = result.value;
            }
            return statuses;
        }, {});
        if (Object.keys(statusesByScheduleId).length === 0) {
            // departure-status는 점진 배포 계약이다. 목록에 저장된 출발 정보를 그대로
            // 유지해 홈 사용성을 보장하고, 지원되지 않는 실패 상태를 꾸며내지 않는다.
            return;
        }
        setSnapshot((current) => ({
            ...current,
            statusesByScheduleId,
        }));
    }, []);

    useEffect(() => {
        if (!focused) {
            requestSequenceRef.current += 1;
            return undefined;
        }

        refresh();
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") refresh();
        });
        return () => {
            requestSequenceRef.current += 1;
            subscription.remove();
        };
    }, [focused, refresh]);

    const effectiveItems = snapshot.source === "calendar-fallback" || snapshot.source === "loading"
        ? fallbackItems
        : snapshot.items;

    return useMemo(() => ({
        ...snapshot,
        items: effectiveItems,
        refresh,
    }), [effectiveItems, refresh, snapshot]);
}

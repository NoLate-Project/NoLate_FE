import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useRouter } from "expo-router";

import type { TravelMode } from "../types";
import { buildRoutePlannerPlace, buildScheduleRoutePlannerInitial, consumeRoutePlannerResult,
    observeRoutePlannerReturn, setRoutePlannerInitial } from "../routePlannerSession";
import { startOfLocalScheduleDay } from "../scheduleFormDate";
import { mergeDateTime } from "./scheduleEditPresentation";

type Setter<T> = Dispatch<SetStateAction<T>>;
type ScheduleEditRoutePlannerInput = {
    pathname: string;
    router: ReturnType<typeof useRouter>;
    routePlannerSessionId?: string;
    setRoutePlannerSessionId: Setter<string | undefined>;
    routePlannerAwayRef: MutableRefObject<boolean>;
    routeTimingTargetArrivalRef: MutableRefObject<string | undefined>;
    pendingRouteTimingTargetArrivalRef: MutableRefObject<string | undefined>;
    markFormDirty: () => void;
    originText: string;
    originAddress?: string;
    originLat?: number;
    originLng?: number;
    destinationText: string;
    destinationAddress?: string;
    destinationLat?: number;
    destinationLng?: number;
    travelMode: TravelMode;
    travelMinutes?: number;
    departAt?: string;
    route: unknown;
    allDay: boolean;
    startDay: Date;
    startTime: Date;
    setOriginText: Setter<string>;
    setOriginAddress: Setter<string | undefined>;
    setOriginLat: Setter<number | undefined>;
    setOriginLng: Setter<number | undefined>;
    setDestinationText: Setter<string>;
    setDestinationAddress: Setter<string | undefined>;
    setDestinationLat: Setter<number | undefined>;
    setDestinationLng: Setter<number | undefined>;
    setTravelMode: Setter<TravelMode>;
    setTravelMinutes: Setter<number | undefined>;
    setDepartAt: Setter<string | undefined>;
    setRoute: Setter<unknown>;
    setNotificationEnabled: Setter<boolean>;
};

/** 일정 폼과 경로 선택 화면 사이의 세션 생성·초기화·복귀 결과 반영을 관리합니다. */
export function useScheduleEditRoutePlanner(input: ScheduleEditRoutePlannerInput) {
    const {
        pathname, router, routePlannerSessionId, setRoutePlannerSessionId, routePlannerAwayRef,
        routeTimingTargetArrivalRef, pendingRouteTimingTargetArrivalRef, markFormDirty,
        originText, originAddress, originLat, originLng, destinationText, destinationAddress,
        destinationLat, destinationLng, travelMode, travelMinutes, departAt, route, allDay,
        startDay, startTime, setOriginText, setOriginAddress, setOriginLat, setOriginLng,
        setDestinationText, setDestinationAddress, setDestinationLat, setDestinationLng,
        setTravelMode, setTravelMinutes, setDepartAt, setRoute, setNotificationEnabled,
    } = input;
    // 현재 입력한 장소와 일정 시작 시각을 경로 선택 화면에 그대로 전달한다.
    /** 현재 장소와 이동 정보를 세션에 저장한 뒤 경로 탐색 화면으로 이동합니다. */
    const openRoutePlanner = useCallback(() => {
        const nextOrigin = buildRoutePlannerPlace({
            name: originText,
            address: originAddress,
            lat: originLat,
            lng: originLng,
        }, "출발지");
        const nextDestination = buildRoutePlannerPlace({
            name: destinationText,
            address: destinationAddress,
            lat: destinationLat,
            lng: destinationLng,
        }, "도착지");
        const sessionId = `route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const targetArrivalAt = allDay
            ? startOfLocalScheduleDay(startDay)
            : mergeDateTime(startDay, startTime);
        pendingRouteTimingTargetArrivalRef.current = targetArrivalAt.toISOString();
        setRoutePlannerInitial(sessionId, buildScheduleRoutePlannerInitial({
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes,
            departureAt: departAt,
            route,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name ?? nextOrigin?.name,
            targetArrivalAt,
        }));

        // setState가 실제 화면 전환보다 먼저 반영될 수 있다. 경로 화면 진입을 확인하기 전에는
        // 아직 비어 있는 세션 결과를 소비하지 않는다.
        routePlannerAwayRef.current = false;
        setRoutePlannerSessionId(sessionId);
        router.push({ pathname: "/schedule/route-select", params: { sessionId } });
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        departAt,
        allDay,
        originAddress,
        originLat,
        originLng,
        originText,
        router,
        startDay,
        startTime,
        travelMinutes,
        travelMode,
        route,
        pendingRouteTimingTargetArrivalRef,
        routePlannerAwayRef,
        setRoutePlannerSessionId,
    ]);

    /** 저장된 경로·출발 시각·이동 시간을 함께 비워 불완전한 경로 상태를 방지합니다. */
    const clearRoute = useCallback(() => {
        markFormDirty();
        setOriginText("");
        setDestinationText("");
        setOriginAddress(undefined);
        setDestinationAddress(undefined);
        setOriginLat(undefined);
        setOriginLng(undefined);
        setDestinationLat(undefined);
        setDestinationLng(undefined);
        setTravelMinutes(undefined);
        setDepartAt(undefined);
        setRoute(undefined);
        routeTimingTargetArrivalRef.current = undefined;
        pendingRouteTimingTargetArrivalRef.current = undefined;
        setNotificationEnabled(false);
    }, [
        markFormDirty,
        pendingRouteTimingTargetArrivalRef,
        routeTimingTargetArrivalRef,
        setDepartAt,
        setDestinationAddress,
        setDestinationLat,
        setDestinationLng,
        setDestinationText,
        setNotificationEnabled,
        setOriginAddress,
        setOriginLat,
        setOriginLng,
        setOriginText,
        setRoute,
        setTravelMinutes,
    ]);

    useEffect(() => {
        if (!routePlannerSessionId) return;
        const observation = observeRoutePlannerReturn(pathname, routePlannerAwayRef.current);
        routePlannerAwayRef.current = observation.hasVisitedRouteFlow;
        if (!observation.shouldConsumeResult) return;

        const result = consumeRoutePlannerResult(routePlannerSessionId);
        const selectedTargetArrivalAt = pendingRouteTimingTargetArrivalRef.current;
        pendingRouteTimingTargetArrivalRef.current = undefined;
        setRoutePlannerSessionId(undefined);
        if (!result) return;

        markFormDirty();
        setOriginText(result.origin?.name ?? "");
        setOriginAddress(result.origin?.address);
        setOriginLat(result.origin?.lat);
        setOriginLng(result.origin?.lng);
        setDestinationText(result.destination?.name ?? "");
        setDestinationAddress(result.destination?.address);
        setDestinationLat(result.destination?.lat);
        setDestinationLng(result.destination?.lng);
        setTravelMode(result.travelMode);
        setTravelMinutes(result.travelMinutes);
        setDepartAt(result.departureAt);
        setRoute(result.route);
        routeTimingTargetArrivalRef.current = selectedTargetArrivalAt ?? result.targetArrivalAt;
    }, [
        markFormDirty,
        pathname,
        pendingRouteTimingTargetArrivalRef,
        routePlannerAwayRef,
        routePlannerSessionId,
        routeTimingTargetArrivalRef,
        setDepartAt,
        setDestinationAddress,
        setDestinationLat,
        setDestinationLng,
        setDestinationText,
        setOriginAddress,
        setOriginLat,
        setOriginLng,
        setOriginText,
        setRoute,
        setRoutePlannerSessionId,
        setTravelMinutes,
        setTravelMode,
    ]);

    return { openRoutePlanner, clearRoute };
}

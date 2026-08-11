import { useRouter } from "expo-router";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Alert } from "react-native";

import { deleteSchedule, getSchedule, updateSchedule } from "../../../api/schedule";
import { upsertMyScheduleTravelPlan } from "../../../api/scheduleTravelPlans";
import { recoverDepartureAlarmsAfterMutation } from "../../notification/departureAlarmMutationRecovery";
import { preserveLegacyCalendarImportMetadata } from "../calendarImportNotes";
import { resolveScheduleAlertModePayload } from "../scheduleAlertMode";
import { normalizeScheduleFormRange } from "../scheduleFormDate";
import { buildScheduleFormLocationName, buildScheduleFormPlace } from "../scheduleFormPlace";
import { hasPersistableScheduleRoute, reconcileScheduleRouteTiming } from "../scheduleRouteTiming";
import { useScheduleStore } from "../store";
import { applyTravelPlanToScheduleItem } from "../travelPlanPresentation";
import type { ScheduleAlertMode, ScheduleCategory, ScheduleItem, TravelMode } from "../types";
import { getErrorMessage, hasCompletePersonalTravelPlanCoordinates } from "./scheduleEditPresentation";

type ScheduleEditMutationContext = {
    title: string;
    category?: ScheduleCategory;
    mutationPending: boolean;
    mutationPendingRef: MutableRefObject<boolean>;
    startDay: Date;
    startTime: Date;
    endDay: Date;
    endTime: Date;
    allDay: boolean;
    hasEndTime: boolean;
    originText: string;
    originAddress?: string;
    originLat?: number;
    originLng?: number;
    destinationText: string;
    destinationAddress?: string;
    destinationLat?: number;
    destinationLng?: number;
    departAt?: string;
    route: unknown;
    travelMinutes?: number;
    routeTimingTargetArrivalRef: MutableRefObject<string | undefined>;
    notificationEnabled: boolean;
    notificationLeadMinutes: number;
    notificationIntervalMinutes: number;
    alertMode: ScheduleAlertMode;
    item: ScheduleItem;
    travelMode: TravelMode;
    canChangeCalendar: boolean;
    calendarId: number | null;
    notes: string;
    dispatch: ReturnType<typeof useScheduleStore>["dispatch"];
    markFormDirty: () => void;
    closeEditScreen: () => void;
    setMutationPending: Dispatch<SetStateAction<boolean>>;
    discardChanges: () => void;
    allowNavigationRef: MutableRefObject<boolean>;
    router: ReturnType<typeof useRouter>;
};

/** 검증된 편집 폼을 저장하거나 현재 일정을 삭제하는 두 가지 서버 변경 작업을 구성합니다. */
export function createScheduleEditMutations(context: ScheduleEditMutationContext) {
    const { title, category, mutationPending, mutationPendingRef, startDay, startTime, endDay, endTime, allDay, hasEndTime, originText, originAddress, originLat, originLng, destinationText, destinationAddress, destinationLat, destinationLng, departAt, route, travelMinutes, routeTimingTargetArrivalRef, notificationEnabled, notificationLeadMinutes, notificationIntervalMinutes, alertMode, item, travelMode, canChangeCalendar, calendarId, notes, dispatch, markFormDirty, closeEditScreen, setMutationPending, discardChanges, allowNavigationRef, router } = context;
    // 수정된 입력값을 백엔드에 저장한 뒤 일정 저장소에 반영한다.
    /** 편집 폼을 검증해 공용 일정과 개인 이동 계획을 저장하고 알람 계획을 복구 동기화합니다. */
    const save = async () => {
        const t = title.trim();
        if (!t || !category || mutationPending || mutationPendingRef.current) return;

        const normalizedRange = normalizeScheduleFormRange({
            startDay,
            startTime,
            endDay,
            endTime,
            allDay,
            hasEndTime,
        });
        const nextOrigin = buildScheduleFormPlace({
            name: originText,
            address: originAddress,
            lat: originLat,
            lng: originLng,
        });
        const nextDestination = buildScheduleFormPlace({
            name: destinationText,
            address: destinationAddress,
            lat: destinationLat,
            lng: destinationLng,
        });
        const locationName = buildScheduleFormLocationName(nextOrigin, nextDestination);
        const nextStartAt = normalizedRange.startAt.toISOString();
        const reconciledRouteTiming = reconcileScheduleRouteTiming({
            departAt,
            route,
            travelMinutes,
            plannedArrivalAt: routeTimingTargetArrivalRef.current,
            nextArrivalAt: nextStartAt,
        });
        const hasRoutePlan = hasPersistableScheduleRoute(
            reconciledRouteTiming.route,
            travelMinutes,
            nextOrigin,
            nextDestination
        );
        const resolvedNotificationEnabled = hasRoutePlan && notificationEnabled;
        const resolvedNotificationLeadMinutes = resolvedNotificationEnabled
            ? notificationLeadMinutes
            : undefined;
        const resolvedNotificationIntervalMinutes = resolvedNotificationEnabled
            ? notificationIntervalMinutes
            : undefined;
        const resolvedAlertMode = resolveScheduleAlertModePayload({
            hasRoutePlan,
            notificationEnabled,
            selectedMode: alertMode,
        });
        const personalTravelPlanPayload = (
            item.sharePermission != null
            && hasRoutePlan
            && typeof travelMinutes === "number"
            && Number.isFinite(travelMinutes)
            && travelMinutes > 0
            && hasCompletePersonalTravelPlanCoordinates(nextOrigin)
            && hasCompletePersonalTravelPlanCoordinates(nextDestination)
        ) ? {
                travelMinutes,
                departAt: reconciledRouteTiming.departAt,
                travelMode,
                origin: nextOrigin,
                route: reconciledRouteTiming.route,
                notificationEnabled: resolvedNotificationEnabled,
                notificationLeadMinutes: resolvedNotificationLeadMinutes,
                notificationIntervalMinutes: resolvedNotificationIntervalMinutes,
                alertMode: resolvedAlertMode,
            }
            : undefined;

        let commonUpdateSucceeded = false;
        try {
            mutationPendingRef.current = true;
            setMutationPending(true);
            const updated = await updateSchedule(item.id, {
                title: t,
                category,
                calendarId: canChangeCalendar ? calendarId : item.calendarId ?? null,
                calendarContentModeOverride: item.calendarContentModeOverride ?? null,
                startAt: nextStartAt,
                endAt: normalizedRange.endAt.toISOString(),
                hasEndTime: normalizedRange.hasEndTime,
                travelMode: hasRoutePlan ? travelMode : undefined,
                travelMinutes: hasRoutePlan ? travelMinutes : undefined,
                departAt: hasRoutePlan ? reconciledRouteTiming.departAt : undefined,
                locationName,
                destination: nextDestination,
                origin: hasRoutePlan ? nextOrigin : undefined,
                notes: preserveLegacyCalendarImportMetadata(item.notes, notes),
                allDay: normalizedRange.allDay,
                route: hasRoutePlan ? reconciledRouteTiming.route : undefined,
                notificationEnabled: resolvedNotificationEnabled,
                notificationLeadMinutes: resolvedNotificationLeadMinutes,
                notificationIntervalMinutes: resolvedNotificationIntervalMinutes,
                alertMode: resolvedAlertMode,
            });
            commonUpdateSucceeded = true;
            dispatch({ type: "UPDATE_ITEM", item: updated });

            if (personalTravelPlanPayload) {
                try {
                    const plan = await upsertMyScheduleTravelPlan(
                        item.id,
                        personalTravelPlanPayload,
                    );
                    dispatch({
                        type: "UPDATE_ITEM",
                        item: applyTravelPlanToScheduleItem(updated, plan),
                    });
                } catch {
                    markFormDirty();
                    try {
                        const refreshed = await getSchedule(item.id);
                        dispatch({ type: "UPDATE_ITEM", item: refreshed });
                    } catch {
                        // 공용 저장 응답은 이미 반영했다. 재조회 실패로 그 상태까지 되돌리지 않는다.
                    }
                    Alert.alert(
                        "일정은 저장했어요",
                        "출발 알림은 저장하지 못했어요. 다시 저장해 주세요.",
                    );
                    return;
                }
            }

            closeEditScreen();
        } catch (error) {
            Alert.alert("일정 수정 실패", getErrorMessage(error));
        } finally {
            if (commonUpdateSucceeded) {
                await recoverDepartureAlarmsAfterMutation();
            }
            mutationPendingRef.current = false;
            setMutationPending(false);
        }
    };

    // 현재 일정을 삭제하고 이전 화면으로 돌아간다.
    /** 사용자 확인 후 일정을 삭제하고 저장소·알람·탐색 상태를 순서대로 정리합니다. */
    const remove = () => {
        if (mutationPending || mutationPendingRef.current) return;
        Alert.alert("일정을 삭제할까요?", "삭제한 일정은 되돌릴 수 없어요.", [
            { text: "취소", style: "cancel" },
            {
                text: "삭제",
                style: "destructive",
                onPress: async () => {
                    try {
                        if (mutationPendingRef.current) return;
                        mutationPendingRef.current = true;
                        setMutationPending(true);
                        await deleteSchedule(item.id);
                        await recoverDepartureAlarmsAfterMutation();
                        discardChanges();
                        allowNavigationRef.current = true;
                        router.replace("/schedule");
                        setTimeout(() => {
                            dispatch({ type: "DELETE_ITEM", id: item.id });
                        }, 0);
                    } catch (error) {
                        Alert.alert("일정 삭제 실패", getErrorMessage(error));
                    } finally {
                        mutationPendingRef.current = false;
                        setMutationPending(false);
                    }
                },
            },
        ]);
    };

    return { save, remove };
}

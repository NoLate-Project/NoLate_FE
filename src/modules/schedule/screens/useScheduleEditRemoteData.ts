import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { getSchedule } from "../../../api/schedule";
import { getScheduleCalendars, type ScheduleCalendar } from "../../../api/scheduleCalendars";
import { getScheduleCategoriesFromApi } from "../../../api/scheduleCategories";
import { FREE_SUBSCRIPTION_POLICY, getMySubscriptionPolicy, type SubscriptionPolicy } from "../../../api/subscription";
import { useScheduleStore } from "../store";
import { getErrorMessage } from "./scheduleEditPresentation";

type Setter<T> = Dispatch<SetStateAction<T>>;
type ScheduleEditRemoteDataInput = {
    developmentPreview: boolean;
    id?: string;
    retryKey: number;
    routePlannerSessionId?: string;
    formDirtyRef: MutableRefObject<boolean>;
    dispatch: ReturnType<typeof useScheduleStore>["dispatch"];
    setDetailLoading: Setter<boolean>;
    setDetailError: Setter<string | null>;
    categoryRetryKey: number;
    setCategoryRetryKey: Setter<number>;
    setCategoryLoading: Setter<boolean>;
    setCategoryError: Setter<string | null>;
    calendarRetryKey: number;
    setCalendarLoading: Setter<boolean>;
    setCalendarError: Setter<string | null>;
    setCalendars: Setter<ScheduleCalendar[]>;
    itemNotificationEnabled?: boolean;
    setSubscriptionPolicy: Setter<SubscriptionPolicy>;
    setNotificationLeadMinutes: Setter<number>;
    setNotificationIntervalMinutes: Setter<number>;
};

/** 일정 상세·카테고리·캘린더·구독 정책을 독립적으로 불러오고 취소된 응답을 무시합니다. */
export function useScheduleEditRemoteData({
    developmentPreview, id, retryKey, routePlannerSessionId, formDirtyRef, dispatch,
    setDetailLoading, setDetailError, categoryRetryKey, setCategoryRetryKey,
    setCategoryLoading, setCategoryError, calendarRetryKey, setCalendarLoading,
    setCalendarError, setCalendars, itemNotificationEnabled, setSubscriptionPolicy,
    setNotificationLeadMinutes, setNotificationIntervalMinutes,
}: ScheduleEditRemoteDataInput) {
    useEffect(() => {
        if (developmentPreview) {
            setDetailLoading(false);
            setDetailError(null);
            return;
        }
        if (!id) return;
        // 경로 선택 화면을 오가는 동안에는 이미 불러온 일정과 로컬 경로 초안을 유지한다.
        // 복귀 직후 재조회가 시작되면 detailLoading 때문에 실제 변경사항이 있어도 저장 버튼이
        // 잠시 비활성화되고, 느린 응답이 새 경로와 경쟁할 수 있다.
        if (routePlannerSessionId || formDirtyRef.current) {
            setDetailLoading(false);
            return;
        }
        let cancelled = false;
        setDetailLoading(true);
        setDetailError(null);

        getSchedule(id)
            .then((detail) => {
                if (cancelled) return;
                dispatch({ type: "UPDATE_ITEM", item: detail });
            })
            .catch((error) => {
                if (cancelled) return;
                setDetailError(getErrorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [developmentPreview, dispatch, formDirtyRef, id, retryKey, routePlannerSessionId, setDetailError, setDetailLoading]);

    useEffect(() => {
        if (developmentPreview) {
            setCategoryLoading(false);
            setCategoryError(null);
            return;
        }
        let cancelled = false;
        setCategoryLoading(true);

        getScheduleCategoriesFromApi()
            .then((categories) => {
                if (cancelled) return;
                dispatch({ type: "SET_CATEGORIES", categories });
                setCategoryError(null);
            })
            .catch(() => {
                if (!cancelled) setCategoryError("카테고리를 불러오지 못했어요.");
            })
            .finally(() => {
                if (!cancelled) setCategoryLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [categoryRetryKey, developmentPreview, dispatch, setCategoryError, setCategoryLoading]);

    useEffect(() => {
        if (developmentPreview) {
            setCalendarLoading(false);
            setCalendarError(null);
            return;
        }
        let cancelled = false;
        setCalendarLoading(true);
        getScheduleCalendars()
            .then((items) => {
                if (cancelled) return;
                setCalendars(items);
                setCalendarError(null);
            })
            .catch(() => {
                if (!cancelled) setCalendarError("공유 캘린더를 불러오지 못했어요.");
            })
            .finally(() => {
                if (!cancelled) setCalendarLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [calendarRetryKey, developmentPreview, setCalendarError, setCalendarLoading, setCalendars]);

    /** 카테고리 조회 오류를 초기화하고 새 요청 세대로 다시 불러옵니다. */
    const retryCategoryLoad = useCallback(() => {
        setCategoryRetryKey((value) => value + 1);
    }, [setCategoryRetryKey]);

    useEffect(() => {
        if (developmentPreview) return;
        let cancelled = false;
        getMySubscriptionPolicy()
            .then((policy) => {
                if (cancelled) return;
                setSubscriptionPolicy(policy);
                if (!itemNotificationEnabled) {
                    setNotificationLeadMinutes((current) =>
                        Math.min(current, policy.maxNotificationLeadMinutes)
                    );
                    setNotificationIntervalMinutes((current) =>
                        Math.max(current, policy.minEtaRefreshIntervalMinutes)
                    );
                }
            })
            .catch(() => {
                if (!cancelled) setSubscriptionPolicy(FREE_SUBSCRIPTION_POLICY);
            });
        return () => {
            cancelled = true;
        };
    }, [
        developmentPreview,
        itemNotificationEnabled,
        setNotificationIntervalMinutes,
        setNotificationLeadMinutes,
        setSubscriptionPolicy,
    ]);

    return { retryCategoryLoad };
}

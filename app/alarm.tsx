import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import NoLateCustomAlarmScreen, {
    type NoLateCustomAlarmDepartureCompletionResult,
} from "../src/modules/notification/NoLateCustomAlarmScreen";
import {
    canCompleteNoLateCustomAlarmDeparture,
    parseNoLateCustomAlarmPresentation,
    type NoLateCustomAlarmSearchParams,
} from "../src/modules/notification/customAlarmPresentation";
import { completeDepartureFromNotificationAction } from "../src/modules/notification/foregroundPush";
import {
    claimNoLateCustomAlarmCapability,
    consumeNoLateCustomAlarmCapability,
    releaseNoLateCustomAlarmCapability,
} from "../src/modules/notification/customAlarmCapability";
import { getAuthMember } from "../src/modules/auth/authStorage";
import { measurePerformanceInteraction } from "../src/modules/performance/interactionPerformance";
import { useScreenContentReadyPerformance } from "../src/modules/performance/useScreenContentReadyPerformance";
import { createScheduleDetailRoute } from "../src/modules/notification/pushNavigation";
import { getSchedule } from "../src/api/schedule";

export default function NoLateCustomAlarmRoute() {
    const params = useLocalSearchParams<NoLateCustomAlarmSearchParams>();
    const router = useRouter();
    const presentation = useMemo(
        () => parseNoLateCustomAlarmPresentation(params),
        [params],
    );
    const [previewScheduleTitle, setPreviewScheduleTitle] = useState<string | null>(null);

    useScreenContentReadyPerformance("alarm.content_ready", "/alarm", true);

    useEffect(() => {
        if (!presentation.isPreview || !presentation.scheduleId) {
            setPreviewScheduleTitle(null);
            return;
        }

        let cancelled = false;
        setPreviewScheduleTitle(null);
        measurePerformanceInteraction(
            "alarm.preview_schedule_load",
            "/alarm",
            () => getSchedule(presentation.scheduleId!),
            "NETWORK",
        )
            .then(schedule => {
                const title = schedule.title.trim();
                if (!cancelled && title) setPreviewScheduleTitle(title);
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [presentation.instanceKey, presentation.isPreview, presentation.scheduleId]);

    const visiblePresentation = useMemo(
        () => previewScheduleTitle
            ? { ...presentation, title: previewScheduleTitle }
            : presentation,
        [presentation, previewScheduleTitle],
    );

    const close = useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace("/schedule");
    }, [router]);

    const openRoute = useCallback((scheduleId: string) => {
        router.replace(createScheduleDetailRoute(scheduleId));
    }, [router]);

    const completeDeparture = useCallback(async (
        scheduleId: string,
    ): Promise<NoLateCustomAlarmDepartureCompletionResult> => {
        // Query parameters are an untrusted deep-link boundary. Recheck the parsed preview/test
        // fence here as well as in the presentation component before performing a real mutation.
        if (
            !canCompleteNoLateCustomAlarmDeparture(presentation) ||
            scheduleId !== presentation.scheduleId
        ) return { status: "rejected", reason: "invalid-presentation" };
        const trustedTarget = claimNoLateCustomAlarmCapability(presentation);
        if (!trustedTarget) {
            return { status: "rejected", reason: "capability-unavailable" };
        }
        try {
            return await measurePerformanceInteraction(
                "alarm.complete_departure",
                "/alarm",
                async () => {
                    const member = await getAuthMember();
                    if (member?.id !== trustedTarget.recipientMemberId) {
                        consumeNoLateCustomAlarmCapability(presentation.capabilityId);
                        throw new Error("CUSTOM_ALARM_ACCOUNT_MISMATCH");
                    }
                    await completeDepartureFromNotificationAction(scheduleId);
                    consumeNoLateCustomAlarmCapability(presentation.capabilityId);
                    return { status: "completed" } as const;
                },
                "INTERACTION",
            );
        } catch (error) {
            releaseNoLateCustomAlarmCapability(presentation.capabilityId);
            throw error;
        }
    }, [presentation]);

    return (
        <NoLateCustomAlarmScreen
            key={presentation.instanceKey}
            presentation={visiblePresentation}
            onClose={close}
            onOpenRoute={openRoute}
            onCompleteDeparture={completeDeparture}
        />
    );
}

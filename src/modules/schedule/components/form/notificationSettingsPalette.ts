import type { RouteInfo } from "../../routeInfo";
import { reconcileScheduleRouteTiming } from "../../scheduleRouteTiming";

type NotificationSettingsPaletteInput = {
    dark: boolean;
    surface: string;
};

/** 테마 모드에 따라 알림 설정 카드에서 공유하는 강조·세그먼트·경고 색상을 계산합니다. */
export function getNotificationSettingsPalette({ dark, surface }: NotificationSettingsPaletteInput) {
    return {
        accentBlue: dark ? "#4B9DFF" : "#2979FF",
        selectedBackground: dark ? "rgba(75,157,255,0.18)" : "#EAF2FF",
        segmentedTrackBackground: dark ? "rgba(118,118,128,0.24)" : "rgba(118,118,128,0.12)",
        segmentedSelectedBackground: surface,
        segmentedUnselectedText: dark ? "rgba(255,255,255,0.68)" : "rgba(0,0,0,0.62)",
        inactiveSwitchTrack: dark ? "#3A3A3C" : "#D1D1D6",
        subtleAccentBackground: dark ? "rgba(75,157,255,0.12)" : "rgba(41,121,255,0.08)",
        warningColor: dark ? "#FFBF69" : "#A85C00",
    };
}
/** ODsay 시간표와 일정 변경 시각을 저장 화면과 같은 기준으로 해석합니다. */
export function getNotificationRouteTiming(route: RouteInfo | undefined, startAt: Date | undefined, plannedArrivalAt?: string) {
    if (!startAt || !Number.isFinite(startAt.getTime())) return {};
    if (route?.provider === "odsay" && route.timeBasis === "provider_schedule" && route.providerTimeBasis === "timetable") {
        const departure = Date.parse(route.departureTime);
        const arrival = Date.parse(route.arrivalTime);
        const planned = Date.parse(plannedArrivalAt ?? "");
        if (Number.isFinite(planned) && planned !== startAt.getTime()) {
            const { departAt } = reconcileScheduleRouteTiming({ route, plannedArrivalAt, nextArrivalAt: startAt });
            return { arrivalAt: startAt, recommendedDepartureAt: departAt ? new Date(departAt) : undefined };
        } else if (departure < arrival && arrival <= startAt.getTime()) {
            return { arrivalAt: new Date(arrival), recommendedDepartureAt: new Date(departure) };
        }
    }
    const routeMinutes = route?.totalDurationMinutes;
    return {
        arrivalAt: startAt,
        recommendedDepartureAt: typeof routeMinutes === "number" && Number.isFinite(routeMinutes) && routeMinutes > 0
            ? new Date(startAt.getTime() - routeMinutes * 60_000)
            : undefined,
    };
}

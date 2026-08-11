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

/** 일정 시작 시각과 예상 이동 시간으로 카드에 표시할 출발·도착 시각을 안전하게 계산합니다. */
export function getNotificationRouteTiming(routeMinutes: number | undefined, startAt: Date | undefined) {
    const arrivalAt = startAt && !Number.isNaN(startAt.getTime()) ? startAt : undefined;
    return {
        arrivalAt,
        recommendedDepartureAt: arrivalAt && typeof routeMinutes === "number"
            ? new Date(arrivalAt.getTime() - routeMinutes * 60 * 1000)
            : undefined,
    };
}

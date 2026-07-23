type TransitDetailBaseColors = {
    textSecondary: string;
    border: string;
};

export function getTransitDetailSummaryPalette(
    isDark: boolean,
    colors: TransitDetailBaseColors
) {
    return {
        metaTextColor: isDark ? "#B8B8B8" : colors.textSecondary,
        borderColor: isDark ? "#343434" : colors.border,
    };
}

export function getRouteDetailSummarySurface(
    isTransitDetailMode: boolean,
    detailCardBackgroundColor: string,
    transitDetailBorderColor: string
) {
    return {
        backgroundColor: isTransitDetailMode ? ("transparent" as const) : detailCardBackgroundColor,
        borderBottomColor: isTransitDetailMode ? transitDetailBorderColor : undefined,
    };
}

export function getTransitDetailScrollViewportHeight(
    visibleSheetHeight: number,
    actionBarReserveHeight: number,
    handleHeight: number
): number {
    if (![visibleSheetHeight, actionBarReserveHeight, handleHeight].every(Number.isFinite)) return 0;
    return Math.max(0, visibleSheetHeight - actionBarReserveHeight - handleHeight);
}

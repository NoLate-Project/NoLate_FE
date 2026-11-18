const ROUTE_CARD_INSET = 8;

/** Keep the start of an oversized card reachable and reveal the rest if it fits. */
export function getScheduleRouteCardScrollOffset(
    offset: number,
    viewportTop: number,
    viewportHeight: number,
    cardTop: number,
    cardHeight: number,
): number {
    if (viewportHeight <= ROUTE_CARD_INSET * 2 || cardHeight <= 0) return offset;

    const topShift = cardTop - viewportTop - ROUTE_CARD_INSET;
    const bottomShift = topShift + cardHeight + ROUTE_CARD_INSET * 2 - viewportHeight;
    const shift = topShift < 0 ? topShift : Math.max(0, Math.min(topShift, bottomShift));
    return Math.max(0, offset + shift);
}

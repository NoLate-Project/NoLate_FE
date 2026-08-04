export const ROUTE_DETAIL_ENTRY_VALUE = "1";

export function isRouteDetailEntryRequested(
    value: string | string[] | undefined,
): boolean {
    return Array.isArray(value)
        ? value.includes(ROUTE_DETAIL_ENTRY_VALUE)
        : value === ROUTE_DETAIL_ENTRY_VALUE;
}

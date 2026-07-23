export const ROUTE_SETUP_ENTRY_VALUE = "1" as const;

export function buildRouteSetupEntryRoute(id: string) {
    return {
        pathname: "/schedule/[id]" as const,
        params: {
            id,
            openRouteSetup: ROUTE_SETUP_ENTRY_VALUE,
        },
    };
}

export function isRouteSetupEntryRequested(
    value: string | string[] | undefined
): boolean {
    return (Array.isArray(value) ? value[0] : value) === ROUTE_SETUP_ENTRY_VALUE;
}

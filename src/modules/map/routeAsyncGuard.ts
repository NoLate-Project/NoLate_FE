export type LatestRequestGuard = {
    begin: () => number;
    invalidate: () => void;
    isCurrent: (requestId: number) => boolean;
};

/**
 * 장소 검색/현재 위치/역지오코딩처럼 취소 API가 없는 비동기 작업에서
 * 가장 마지막 사용자 의도만 화면에 반영하도록 하는 작은 요청 가드다.
 */
export function createLatestRequestGuard(): LatestRequestGuard {
    let latestRequestId = 0;

    return {
        begin() {
            latestRequestId += 1;
            return latestRequestId;
        },
        invalidate() {
            latestRequestId += 1;
        },
        isCurrent(requestId) {
            return requestId === latestRequestId;
        },
    };
}

export function canPersistResolvedRoute(input: {
    hasRouteReady: boolean;
    routeLoading: boolean;
    hasSelectedRoute: boolean;
    routeError?: string;
}): boolean {
    return input.hasRouteReady &&
        !input.routeLoading &&
        input.hasSelectedRoute &&
        !input.routeError;
}

export type TransitStopMarkerKind = "BUS" | "SUBWAY";

export type TransitStopMarkerPolicy = {
    visible: boolean;
    maxPerLeg: number;
    maxTotal: number;
    markerSize: number;
    showLabels: boolean;
    maxLabelsPerLeg: number;
    maxLabelsTotal: number;
};

const HIDDEN_POLICY: TransitStopMarkerPolicy = {
    visible: false,
    maxPerLeg: 0,
    maxTotal: 0,
    markerSize: 0,
    showLabels: false,
    maxLabelsPerLeg: 0,
    maxLabelsTotal: 0,
};

/**
 * 버스 정류장은 본선 위에서도 식별되는 링 크기를 유지하되 노출 수를 제한해
 * 경로 주변에 충분한 여백을 둔다. 고배율에서는 지도 기본 POI에 가려지지 않도록
 * 버스와 지하철 모두 경로에 속한 정류장 이름을 제한적으로 함께 표시한다.
 */
export function getTransitStopMarkerPolicy(
    kind: TransitStopMarkerKind,
    mapZoom: number
): TransitStopMarkerPolicy {
    if (!Number.isFinite(mapZoom)) return HIDDEN_POLICY;

    if (kind === "BUS") {
        if (mapZoom < 14.4) return HIDDEN_POLICY;
        if (mapZoom < 15.5) {
            return {
                visible: true,
                maxPerLeg: 3,
                maxTotal: 6,
                markerSize: 13,
                showLabels: false,
                maxLabelsPerLeg: 0,
                maxLabelsTotal: 0,
            };
        }
        if (mapZoom < 16.8) {
            return {
                visible: true,
                maxPerLeg: 6,
                maxTotal: 12,
                markerSize: 14,
                showLabels: false,
                maxLabelsPerLeg: 0,
                maxLabelsTotal: 0,
            };
        }
        if (mapZoom < 17.5) return {
            visible: true,
            maxPerLeg: 14,
            maxTotal: 24,
            markerSize: 15,
            showLabels: true,
            maxLabelsPerLeg: 4,
            maxLabelsTotal: 8,
        };
        return {
            visible: true,
            maxPerLeg: 20,
            maxTotal: 32,
            markerSize: 16,
            showLabels: true,
            maxLabelsPerLeg: 7,
            maxLabelsTotal: 14,
        };
    }

    if (mapZoom < 15.2) return HIDDEN_POLICY;
    if (mapZoom < 16.8) {
        return {
            visible: true,
            maxPerLeg: 4,
            maxTotal: 8,
            markerSize: 13,
            showLabels: false,
            maxLabelsPerLeg: 0,
            maxLabelsTotal: 0,
        };
    }
    if (mapZoom < 17.5) return {
        visible: true,
        maxPerLeg: 10,
        maxTotal: 16,
        markerSize: 14,
        showLabels: true,
        maxLabelsPerLeg: 4,
        maxLabelsTotal: 8,
    };
    return {
        visible: true,
        maxPerLeg: 14,
        maxTotal: 22,
        markerSize: 15,
        showLabels: true,
        maxLabelsPerLeg: 6,
        maxLabelsTotal: 12,
    };
}

/**
 * 긴 노선에서도 앞쪽 정류장에 치우치지 않도록 첫 지점부터 마지막 지점까지 고르게 고른다.
 * selectedIndex가 있으면 샘플링 결과에 반드시 포함한다.
 */
export function sampleTransitStopIndices(
    count: number,
    limit: number,
    selectedIndex?: number
): number[] {
    const safeCount = Math.max(0, Math.floor(count));
    const safeLimit = Math.max(0, Math.min(safeCount, Math.floor(limit)));
    if (safeCount === 0 || safeLimit === 0) return [];
    if (safeCount <= safeLimit) return Array.from({ length: safeCount }, (_, index) => index);

    const normalizedSelected = Number.isInteger(selectedIndex)
        && (selectedIndex as number) >= 0
        && (selectedIndex as number) < safeCount
        ? selectedIndex
        : undefined;

    if (safeLimit === 1) {
        return [normalizedSelected ?? Math.floor((safeCount - 1) / 2)];
    }

    const sampled = new Set<number>();
    for (let slot = 0; slot < safeLimit; slot += 1) {
        sampled.add(Math.round((slot * (safeCount - 1)) / (safeLimit - 1)));
    }

    if (normalizedSelected !== undefined && !sampled.has(normalizedSelected)) {
        const replaceable = [...sampled]
            .sort((left, right) => Math.abs(left - normalizedSelected) - Math.abs(right - normalizedSelected))[0];
        if (replaceable !== undefined) sampled.delete(replaceable);
        sampled.add(normalizedSelected);
    }

    return [...sampled].sort((left, right) => left - right);
}

/**
 * 전역 마커 한도 안에서도 각 승차 구간이 최소 한 개의 중간 정류장을 갖도록 예산을 나눈다.
 */
export function allocateTransitStopMarkerCounts(
    candidateCounts: number[],
    totalLimit: number
): number[] {
    const counts = candidateCounts.map((count) => Math.max(0, Math.floor(count)));
    const safeLimit = Math.max(0, Math.floor(totalLimit));
    const allocations = counts.map(() => 0);
    const totalCount = counts.reduce((sum, count) => sum + count, 0);
    if (safeLimit === 0 || totalCount === 0) return allocations;
    if (totalCount <= safeLimit) return counts;

    const positiveIndices = counts
        .map((count, index) => count > 0 ? index : -1)
        .filter((index) => index >= 0);

    if (positiveIndices.length > safeLimit) {
        const selectedGroups = sampleTransitStopIndices(positiveIndices.length, safeLimit);
        selectedGroups.forEach((groupIndex) => {
            allocations[positiveIndices[groupIndex]] = 1;
        });
        return allocations;
    }

    positiveIndices.forEach((index) => {
        allocations[index] = 1;
    });

    let remaining = safeLimit - positiveIndices.length;
    while (remaining > 0) {
        let nextIndex = -1;
        let nextPressure = -1;
        counts.forEach((count, index) => {
            if (allocations[index] >= count) return;
            const pressure = count / (allocations[index] + 1);
            if (pressure > nextPressure) {
                nextPressure = pressure;
                nextIndex = index;
            }
        });
        if (nextIndex < 0) break;
        allocations[nextIndex] += 1;
        remaining -= 1;
    }

    return allocations;
}

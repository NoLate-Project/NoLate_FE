export type NativeDashPathCoord = {
    latitude: number;
    longitude: number;
};

export type NativeDashPathOverlay = {
    id: string;
    coords: NativeDashPathCoord[];
    color?: string;
    width?: number;
    opacity?: number;
    outlineColor?: string;
    outlineWidth?: number;
    outlineOpacity?: number;
    outlineStrokeStyle?: "solid" | "dash" | "dot";
    dashPattern?: number[];
    strokeStyle?: "solid" | "dash" | "dot";
    renderMode?: "native" | "screen";
    shape?: "solid" | "dot";
    nativeDirection?: boolean;
    dotColor?: string;
    dotOutlineColor?: string;
    dotOutlineWidth?: number;
    dotSizePx?: number;
    dotSpacingPx?: number;
    drawLine?: boolean;
    zIndex?: number;
};

export type ExpandedNativeDashPathOverlay<T extends NativeDashPathOverlay> =
    Omit<T, keyof NativeDashPathOverlay> & NativeDashPathOverlay;

const WEB_MERCATOR_TILE_SIZE = 256;
const MIN_PATTERN_PX = 1;
export const MAX_TOTAL_NATIVE_DASH_FRAGMENTS = 240;

export type NativeDashViewport = {
    center: NativeDashPathCoord;
    widthPx: number;
    heightPx: number;
    paddingPx?: number;
};

type NativeDashExpansionOptions = {
    viewport?: NativeDashViewport;
    maxFragments?: number;
};

type WorldPoint = {
    x: number;
    y: number;
};

type WorldRect = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};

type WorldSegment = {
    from: WorldPoint;
    to: WorldPoint;
    length: number;
    unitX: number;
    unitY: number;
};

type DashOverlayGeometry<T extends NativeDashPathOverlay> = {
    index: number;
    overlay: T;
    points: WorldPoint[];
    segments: WorldSegment[];
    totalLength: number;
    exactPathKey: string;
};

const COVERAGE_DEDUPE_MIN_ZOOM = 0;
const COVERAGE_MAX_SAMPLES = 96;
const COVERAGE_DIRECTION_COSINE = 0.82;
const COVERAGE_RATIO_THRESHOLD = 0.85;
const WEB_MERCATOR_METERS_PER_PIXEL_AT_ZOOM_ZERO = 156543.033928;

function clampLatitude(latitude: number): number {
    return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}

function toWorldPoint(coord: NativeDashPathCoord, zoom: number): WorldPoint {
    const latitude = clampLatitude(coord.latitude);
    const sinLatitude = Math.sin((latitude * Math.PI) / 180);
    const scale = WEB_MERCATOR_TILE_SIZE * (2 ** zoom);
    return {
        x: ((coord.longitude + 180) / 360) * scale,
        y: (0.5 - (Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI))) * scale,
    };
}

function fromWorldPoint(point: WorldPoint, zoom: number): NativeDashPathCoord {
    const scale = WEB_MERCATOR_TILE_SIZE * (2 ** zoom);
    const longitude = ((point.x / scale) * 360) - 180;
    const mercatorY = 0.5 - (point.y / scale);
    const latitude = (90 - ((360 * Math.atan(Math.exp(-mercatorY * 2 * Math.PI))) / Math.PI));
    return { latitude, longitude };
}

function isFiniteCoord(coord: NativeDashPathCoord | undefined): coord is NativeDashPathCoord {
    return !!coord && Number.isFinite(coord.latitude) && Number.isFinite(coord.longitude);
}

function pointDistance(from: WorldPoint, to: WorldPoint): number {
    return Math.hypot(to.x - from.x, to.y - from.y);
}

function interpolatePoint(from: WorldPoint, to: WorldPoint, ratio: number): WorldPoint {
    return {
        x: from.x + ((to.x - from.x) * ratio),
        y: from.y + ((to.y - from.y) * ratio),
    };
}

function sameWorldPoint(a: WorldPoint | undefined, b: WorldPoint): boolean {
    return !!a && Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7;
}

function appendDistinctWorldPoint(points: WorldPoint[], point: WorldPoint): void {
    if (!sameWorldPoint(points[points.length - 1], point)) points.push(point);
}

function getViewportWorldRect(
    viewport: NativeDashViewport | undefined,
    zoom: number
): WorldRect | undefined {
    if (!viewport || !isFiniteCoord(viewport.center)) return undefined;
    if (!Number.isFinite(viewport.widthPx) || !Number.isFinite(viewport.heightPx)) return undefined;
    if (viewport.widthPx <= 0 || viewport.heightPx <= 0) return undefined;
    const padding = Number.isFinite(viewport.paddingPx)
        ? Math.max(0, viewport.paddingPx ?? 0)
        : 128;
    const center = toWorldPoint(viewport.center, zoom);
    const halfWidth = (viewport.widthPx / 2) + padding;
    const halfHeight = (viewport.heightPx / 2) + padding;
    return {
        minX: center.x - halfWidth,
        maxX: center.x + halfWidth,
        minY: center.y - halfHeight,
        maxY: center.y + halfHeight,
    };
}

function clipWorldSegment(
    from: WorldPoint,
    to: WorldPoint,
    rect: WorldRect
): [WorldPoint, WorldPoint] | undefined {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let startRatio = 0;
    let endRatio = 1;
    const tests: Array<[number, number]> = [
        [-dx, from.x - rect.minX],
        [dx, rect.maxX - from.x],
        [-dy, from.y - rect.minY],
        [dy, rect.maxY - from.y],
    ];

    for (const [direction, distance] of tests) {
        if (Math.abs(direction) < 1e-12) {
            if (distance < 0) return undefined;
            continue;
        }
        const ratio = distance / direction;
        if (direction < 0) {
            if (ratio > endRatio) return undefined;
            startRatio = Math.max(startRatio, ratio);
        } else {
            if (ratio < startRatio) return undefined;
            endRatio = Math.min(endRatio, ratio);
        }
    }
    if (startRatio > endRatio) return undefined;
    return [
        interpolatePoint(from, to, startRatio),
        interpolatePoint(from, to, endRatio),
    ];
}

function clipWorldPolyline(points: WorldPoint[], rect: WorldRect): WorldPoint[][] {
    const parts: WorldPoint[][] = [];
    for (let index = 1; index < points.length; index += 1) {
        const clipped = clipWorldSegment(points[index - 1], points[index], rect);
        if (!clipped) continue;
        const previousPart = parts[parts.length - 1];
        if (previousPart && sameWorldPoint(previousPart[previousPart.length - 1], clipped[0])) {
            appendDistinctWorldPoint(previousPart, clipped[1]);
        } else {
            parts.push([clipped[0], clipped[1]]);
        }
    }
    return parts;
}

function normalizePattern(pattern: number[] | undefined): [number, number] | undefined {
    if (!Array.isArray(pattern) || pattern.length < 2) return undefined;
    const dash = Number(pattern[0]);
    const gap = Number(pattern[1]);
    if (!Number.isFinite(dash) || !Number.isFinite(gap)) return undefined;
    if (dash < MIN_PATTERN_PX || gap < MIN_PATTERN_PX) return undefined;
    return [dash, gap];
}

function totalWorldDistance(points: WorldPoint[]): number {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += pointDistance(points[index - 1], points[index]);
    }
    return total;
}

function normalizeStyleColor(color: string | undefined): string {
    return (color ?? "").replace(/\s+/g, "").toLowerCase();
}

function normalizeStyleNumber(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function dashStylesMatch(
    first: NativeDashPathOverlay,
    second: NativeDashPathOverlay
): boolean {
    const firstPattern = normalizePattern(first.dashPattern);
    const secondPattern = normalizePattern(second.dashPattern);
    if (!firstPattern || !secondPattern) return false;
    const firstWidth = normalizeStyleNumber(first.width, 1);
    const secondWidth = normalizeStyleNumber(second.width, 1);
    const widthRatio = Math.min(firstWidth, secondWidth) / Math.max(firstWidth, secondWidth);
    const firstOutlineWidth = normalizeStyleNumber(first.outlineWidth, 0);
    const secondOutlineWidth = normalizeStyleNumber(second.outlineWidth, 0);
    return (
        firstPattern[0] === secondPattern[0] &&
        firstPattern[1] === secondPattern[1] &&
        normalizeStyleColor(first.color) === normalizeStyleColor(second.color) &&
        widthRatio >= 0.9 &&
        Math.abs(normalizeStyleNumber(first.opacity, 1) - normalizeStyleNumber(second.opacity, 1)) <= 0.025 &&
        normalizeStyleColor(first.outlineColor) === normalizeStyleColor(second.outlineColor) &&
        Math.abs(firstOutlineWidth - secondOutlineWidth) <= 0.25 &&
        Math.abs(
            normalizeStyleNumber(first.outlineOpacity, 1) -
            normalizeStyleNumber(second.outlineOpacity, 1)
        ) <= 0.025 &&
        (first.outlineStrokeStyle ?? "solid") === (second.outlineStrokeStyle ?? "solid") &&
        (first.shape ?? "solid") === (second.shape ?? "solid") &&
        !!first.nativeDirection === !!second.nativeDirection
    );
}

function toWorldSegments(points: WorldPoint[]): WorldSegment[] {
    const segments: WorldSegment[] = [];
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        const length = pointDistance(from, to);
        if (!Number.isFinite(length) || length < 1e-6) continue;
        segments.push({
            from,
            to,
            length,
            unitX: (to.x - from.x) / length,
            unitY: (to.y - from.y) / length,
        });
    }
    return segments;
}

function canonicalWorldPathKey(points: WorldPoint[]): string {
    const forward = points
        .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
        .join(">");
    const reverse = points
        .slice()
        .reverse()
        .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
        .join(">");
    return forward < reverse ? forward : reverse;
}

function pointToWorldSegmentDistance(point: WorldPoint, segment: WorldSegment): number {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    const ratio = lengthSquared <= 0
        ? 0
        : Math.max(0, Math.min(1, (
            ((point.x - segment.from.x) * dx) + ((point.y - segment.from.y) * dy)
        ) / lengthSquared));
    return Math.hypot(
        point.x - (segment.from.x + (dx * ratio)),
        point.y - (segment.from.y + (dy * ratio))
    );
}

function getMetersPerPixel(overlay: NativeDashPathOverlay, zoom: number): number {
    const latitude = overlay.coords.find(isFiniteCoord)?.latitude ?? 0;
    return (
        WEB_MERCATOR_METERS_PER_PIXEL_AT_ZOOM_ZERO *
        Math.max(0.01, Math.cos((clampLatitude(latitude) * Math.PI) / 180))
    ) / (2 ** zoom);
}

function getCoverageTolerance(
    overlay: NativeDashPathOverlay,
    covering: DashOverlayGeometry<NativeDashPathOverlay>[],
    zoom: number
): number {
    const maxWidth = Math.max(
        normalizeStyleNumber(overlay.width, 4),
        ...covering.map((geometry) => normalizeStyleNumber(geometry.overlay.width, 4))
    );
    const visualTolerance = Math.max(1.25, Math.min(2.75, (maxWidth * 0.55) + 0.35));
    const groundCappedTolerance = 4 / Math.max(0.01, getMetersPerPixel(overlay, zoom));
    return Math.max(0.0001, Math.min(visualTolerance, groundCappedTolerance));
}

function isPointCoveredByGeometry(
    point: WorldPoint,
    candidateSegment: WorldSegment | undefined,
    geometries: DashOverlayGeometry<NativeDashPathOverlay>[],
    tolerance: number,
    requireAlignedDirection: boolean
): boolean {
    for (const geometry of geometries) {
        for (const segment of geometry.segments) {
            if (
                requireAlignedDirection &&
                candidateSegment &&
                Math.abs(
                    (candidateSegment.unitX * segment.unitX) +
                    (candidateSegment.unitY * segment.unitY)
                ) < COVERAGE_DIRECTION_COSINE
            ) {
                continue;
            }
            if (pointToWorldSegmentDistance(point, segment) <= tolerance) return true;
        }
    }
    return false;
}

function getPointAndSegmentAtDistance(
    segments: WorldSegment[],
    distance: number
): { point: WorldPoint; segment: WorldSegment } | undefined {
    let traversed = 0;
    for (const segment of segments) {
        const nextTraversed = traversed + segment.length;
        if (distance <= nextTraversed || segment === segments[segments.length - 1]) {
            const ratio = segment.length <= 0
                ? 0
                : Math.max(0, Math.min(1, (distance - traversed) / segment.length));
            return {
                point: interpolatePoint(segment.from, segment.to, ratio),
                segment,
            };
        }
        traversed = nextTraversed;
    }
    return undefined;
}

function isGeometryCovered(
    candidate: DashOverlayGeometry<NativeDashPathOverlay>,
    covering: DashOverlayGeometry<NativeDashPathOverlay>[],
    zoom: number
): boolean {
    if (covering.length === 0 || candidate.segments.length === 0) return false;
    const tolerance = getCoverageTolerance(candidate.overlay, covering, zoom);
    const start = candidate.points[0];
    const end = candidate.points[candidate.points.length - 1];
    if (
        !isPointCoveredByGeometry(start, undefined, covering, tolerance, false) ||
        !isPointCoveredByGeometry(end, undefined, covering, tolerance, false)
    ) {
        return false;
    }

    const metersPerPixel = getMetersPerPixel(candidate.overlay, zoom);
    const sampleSpacing = Math.max(0.25, Math.min(4, 5 / Math.max(0.01, metersPerPixel)));
    const sampleCount = Math.max(9, Math.min(
        COVERAGE_MAX_SAMPLES,
        Math.ceil(candidate.totalLength / sampleSpacing)
    ));
    let coveredCount = 0;
    let currentUncoveredCount = 0;
    let longestUncoveredCount = 0;
    for (let index = 0; index < sampleCount; index += 1) {
        const distance = candidate.totalLength * ((index + 0.5) / sampleCount);
        const sample = getPointAndSegmentAtDistance(candidate.segments, distance);
        if (
            sample &&
            isPointCoveredByGeometry(sample.point, sample.segment, covering, tolerance, true)
        ) {
            coveredCount += 1;
            currentUncoveredCount = 0;
        } else {
            currentUncoveredCount += 1;
            longestUncoveredCount = Math.max(longestUncoveredCount, currentUncoveredCount);
        }
    }
    const sampleLength = candidate.totalLength / sampleCount;
    const maxAllowedUncoveredLength = Math.min(4, 8 / Math.max(0.01, metersPerPixel));
    return (
        (coveredCount / sampleCount) >= COVERAGE_RATIO_THRESHOLD &&
        (longestUncoveredCount * sampleLength) < maxAllowedUncoveredLength
    );
}

/**
 * 비동기 connector와 정규화 WALK leg가 같은 보행로를 다시 그릴 때 dash 위상이
 * 서로 어긋나 촘촘한 실선처럼 보인다. 같은 스타일의 완전 포함 경로만 제거하고,
 * 끝점이 벗어나는 실제 분기/연장 경로는 그대로 보존한다.
 */
export function dedupeCoveredNativeDashPathOverlays<T extends NativeDashPathOverlay>(
    overlays: T[],
    rawZoom: number
): T[] {
    if (overlays.length < 2) return overlays;
    const zoom = Math.max(0, Math.min(24, Number(rawZoom) || 0));
    const geometries = overlays.flatMap((overlay, index): DashOverlayGeometry<T>[] => {
        if (
            overlay.renderMode === "screen" ||
            overlay.strokeStyle !== "dash" ||
            !normalizePattern(overlay.dashPattern)
        ) {
            return [];
        }
        const points = overlay.coords.filter(isFiniteCoord).map((coord) => toWorldPoint(coord, zoom));
        const segments = toWorldSegments(points);
        const totalLength = segments.reduce((total, segment) => total + segment.length, 0);
        if (points.length < 2 || totalLength < 0.5) return [];
        return [{
            index,
            overlay,
            points,
            segments,
            totalLength,
            exactPathKey: canonicalWorldPathKey(points),
        }];
    });
    if (geometries.length < 2) return overlays;

    const kept: DashOverlayGeometry<T>[] = [];
    const removedIndexes = new Set<number>();
    const ordered = geometries.slice().sort((first, second) => (
        (second.totalLength - first.totalLength) ||
        (normalizeStyleNumber(second.overlay.width, 0) - normalizeStyleNumber(first.overlay.width, 0)) ||
        (normalizeStyleNumber(second.overlay.zIndex, 0) - normalizeStyleNumber(first.overlay.zIndex, 0)) ||
        (first.index - second.index)
    ));

    for (const candidate of ordered) {
        const compatible = kept.filter((geometry) => dashStylesMatch(candidate.overlay, geometry.overlay));
        const hasExactDuplicate = compatible.some((geometry) => (
            geometry.exactPathKey === candidate.exactPathKey
        ));
        const isCovered = zoom >= COVERAGE_DEDUPE_MIN_ZOOM &&
            isGeometryCovered(candidate, compatible, zoom);
        if (hasExactDuplicate || isCovered) {
            removedIndexes.add(candidate.index);
        } else {
            kept.push(candidate);
        }
    }

    return removedIndexes.size > 0
        ? overlays.filter((_, index) => !removedIndexes.has(index))
        : overlays;
}

/**
 * TMAP Web SDK의 `strokeStyle: "dash"`는 간격을 고정값으로만 그린다.
 * 지정한 화면 픽셀 리듬을 실제 지도 이동에도 붙어 있는 native Polyline 조각으로 변환한다.
 */
export function expandNativeDashPathOverlay<T extends NativeDashPathOverlay>(
    overlay: T,
    rawZoom: number,
    options?: NativeDashExpansionOptions
): ExpandedNativeDashPathOverlay<T>[] {
    const pattern = normalizePattern(overlay.dashPattern);
    if (
        overlay.renderMode === "screen" ||
        overlay.strokeStyle !== "dash" ||
        !pattern ||
        overlay.coords.length < 2
    ) {
        return [overlay];
    }

    const coords = overlay.coords.filter(isFiniteCoord);
    if (coords.length < 2) return [overlay];
    const zoom = Math.max(0, Math.min(24, Number(rawZoom) || 0));
    const worldPoints = coords.map((coord) => toWorldPoint(coord, zoom));
    const viewportRect = getViewportWorldRect(options?.viewport, zoom);
    const pathDistance = totalWorldDistance(worldPoints);
    if (!Number.isFinite(pathDistance) || pathDistance < 0.5) return [overlay];

    const [dashLength, gapLength] = pattern;
    const maxFragments = Number.isFinite(options?.maxFragments)
        ? Math.max(1, Math.floor(options?.maxFragments ?? 1))
        : Number.POSITIVE_INFINITY;

    const dashCoords: NativeDashPathCoord[][] = [];
    const appendVisibleDash = (dashPoints: WorldPoint[]): boolean => {
        const visibleParts = viewportRect
            ? clipWorldPolyline(dashPoints, viewportRect)
            : [dashPoints];
        for (const part of visibleParts) {
            if (part.length < 2 || pointDistance(part[0], part[part.length - 1]) < 1e-7) continue;
            dashCoords.push(part.map((point) => fromWorldPoint(point, zoom)));
            if (dashCoords.length >= maxFragments) return true;
        }
        return false;
    };
    let drawingDash = true;
    let patternRemaining = dashLength;
    let currentDash: WorldPoint[] = [worldPoints[0]];

    for (let segmentIndex = 1; segmentIndex < worldPoints.length; segmentIndex += 1) {
        const segmentStart = worldPoints[segmentIndex - 1];
        const segmentEnd = worldPoints[segmentIndex];
        const segmentDistance = pointDistance(segmentStart, segmentEnd);
        if (!Number.isFinite(segmentDistance) || segmentDistance < 1e-6) continue;

        let segmentTraveled = 0;
        while (segmentTraveled < segmentDistance - 1e-7) {
            const step = Math.min(patternRemaining, segmentDistance - segmentTraveled);
            const nextDistance = segmentTraveled + step;
            const nextPoint = interpolatePoint(segmentStart, segmentEnd, nextDistance / segmentDistance);

            if (drawingDash) appendDistinctWorldPoint(currentDash, nextPoint);

            segmentTraveled = nextDistance;
            patternRemaining -= step;
            if (patternRemaining > 1e-7) continue;

            if (drawingDash) {
                if (currentDash.length >= 2 && appendVisibleDash(currentDash)) {
                    return buildExpandedNativeDashOverlays(overlay, dashCoords);
                }
                currentDash = [];
                drawingDash = false;
                patternRemaining = gapLength;
            } else {
                currentDash = [nextPoint];
                drawingDash = true;
                patternRemaining = dashLength;
            }
        }
    }

    if (drawingDash && currentDash.length >= 2) appendVisibleDash(currentDash);
    if (dashCoords.length === 0) return viewportRect ? [] : [overlay];

    return buildExpandedNativeDashOverlays(overlay, dashCoords);
}

function buildExpandedNativeDashOverlays<T extends NativeDashPathOverlay>(
    overlay: T,
    dashCoords: NativeDashPathCoord[][]
): ExpandedNativeDashPathOverlay<T>[] {
    return dashCoords.map((coordsForDash, index) => ({
        ...overlay,
        id: `${overlay.id}--native-dash-${index}`,
        coords: coordsForDash,
        // 각 조각을 solid로 그려 SDK 기본의 촘촘한 dash 리듬을 우회한다.
        // dashPattern은 진단 레이어 분류와 설정 signature를 위해 유지한다.
        strokeStyle: "solid",
    }));
}

function toScreenDotOverlay<T extends NativeDashPathOverlay>(
    overlay: T
): ExpandedNativeDashPathOverlay<T> {
    const [dashLength, gapLength] = normalizePattern(overlay.dashPattern) ?? [1, 13];
    const width = Number.isFinite(overlay.width) ? Math.max(1, overlay.width ?? 1) : 4.4;
    const outlineWidth = Number.isFinite(overlay.outlineWidth)
        ? Math.max(0, overlay.outlineWidth ?? 0)
        : 0;
    return {
        ...overlay,
        renderMode: "screen",
        shape: "dot",
        strokeStyle: "solid",
        nativeDirection: false,
        dotColor: overlay.color,
        dotSizePx: width + Math.min(1, dashLength),
        dotSpacingPx: dashLength + gapLength,
        dotOutlineColor: overlay.outlineColor,
        dotOutlineWidth: outlineWidth * 2,
        drawLine: false,
    };
}

export function expandNativeDashPathOverlays<T extends NativeDashPathOverlay>(
    overlays: T[],
    zoom: number,
    viewport?: NativeDashViewport
): ExpandedNativeDashPathOverlay<T>[] {
    const dedupedOverlays = dedupeCoveredNativeDashPathOverlays(overlays, zoom);
    const entries = dedupedOverlays.map((overlay) => {
        const items = expandNativeDashPathOverlay(overlay, zoom, {
            viewport,
            maxFragments: MAX_TOTAL_NATIVE_DASH_FRAGMENTS + 1,
        });
        const expandedDash = overlay.strokeStyle === "dash" &&
            (items.length !== 1 || items[0] !== overlay);
        return { overlay, items, expandedDash };
    });
    let nativeFragmentCount = entries.reduce(
        (total, entry) => total + (entry.expandedDash ? entry.items.length : 0),
        0
    );
    const screenFallbackIds = new Set<string>();
    if (nativeFragmentCount > MAX_TOTAL_NATIVE_DASH_FRAGMENTS) {
        const candidates = entries
            .filter((entry) => entry.expandedDash && entry.items.length > 0)
            .sort((a, b) => b.items.length - a.items.length);
        for (const candidate of candidates) {
            if (nativeFragmentCount <= MAX_TOTAL_NATIVE_DASH_FRAGMENTS) break;
            screenFallbackIds.add(candidate.overlay.id);
            nativeFragmentCount -= candidate.items.length;
        }
    }

    let expanded = false;
    const result = entries.flatMap((entry) => {
        if (screenFallbackIds.has(entry.overlay.id)) {
            expanded = true;
            return [toScreenDotOverlay(entry.overlay)];
        }
        if (entry.items.length !== 1 || entry.items[0] !== entry.overlay) expanded = true;
        return entry.items;
    });
    return expanded || dedupedOverlays !== overlays ? result : overlays;
}

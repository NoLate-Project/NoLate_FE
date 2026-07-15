import type { TransitLegDetail, TransitPassStop } from "./tmapApi";

type TransitDirectionSource = {
    directionName?: string;
    startName?: string;
    endName?: string;
    passStops?: Array<Pick<TransitPassStop, "name">>;
};

export type TransitBoardingLabelPresentation = {
    primary: string;
    secondary?: string;
};

function normalizeStopName(value?: string): string | undefined {
    const normalized = value
        ?.replace(/\s+/g, " ")
        .replace(/\((?:상행|하행|내선|외선|내선순환|외선순환)\)/gu, "")
        .trim();
    return normalized || undefined;
}
function comparableStopName(value?: string): string | undefined {
    return normalizeStopName(value)
        ?.normalize("NFKC")
        .replace(/[\s·.,()]/gu, "")
        .replace(/(?:역|정류장)+$/u, "");
}

function normalizeDirectionLabel(value?: string): string | undefined {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    if (/(?:방향|방면|행|상행|하행|내선|외선|순환)$/u.test(normalized)) return normalized;
    return `${normalized} 방향`;
}

/**
 * 공급자 방면을 우선하고, 없으면 실제 통과 정류장 순서의 다음 정류장으로 진행 방향을 만든다.
 * 구간 하차 지점은 열차·버스의 종착지가 아니므로 마지막 fallback에서만 "까지"로 표시한다.
 */
export function getTransitBoardingDirectionHint(
    source: TransitDirectionSource
): string | undefined {
    const providerDirection = normalizeDirectionLabel(source.directionName);
    if (providerDirection) return providerDirection;

    const boardName = comparableStopName(source.startName);
    const passStops = source.passStops ?? [];
    const boardIndex = passStops.findIndex((stop) => comparableStopName(stop.name) === boardName);
    const searchStart = boardIndex >= 0 ? boardIndex + 1 : 0;
    const nextStop = passStops.slice(searchStart).find((stop) => (
        !!normalizeStopName(stop.name) && comparableStopName(stop.name) !== boardName
    ));
    if (nextStop?.name) return `${normalizeStopName(nextStop.name) ?? nextStop.name} 방향`;

    const endName = normalizeStopName(source.endName);
    return endName ? `${endName}까지` : undefined;
}

export function getTransitBoardingLabelPresentation(
    leg: Pick<TransitLegDetail, "directionName" | "startName" | "endName" | "passStops">,
    lineLabel?: string
): TransitBoardingLabelPresentation | undefined {
    const stopName = normalizeStopName(leg.startName);
    const primary = [lineLabel?.trim(), stopName]
        .filter((value): value is string => !!value)
        .join(" · ");
    if (!primary) return undefined;

    return {
        primary,
        secondary: getTransitBoardingDirectionHint(leg),
    };
}

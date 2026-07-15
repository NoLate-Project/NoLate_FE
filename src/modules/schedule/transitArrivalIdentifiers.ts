export type TransitPassStopIdentifier = {
    code?: string;
};

export type BusArrivalStationIdentifiers = {
    arsId?: string;
    cityCode?: string;
    nodeId?: string;
    stationName?: string;
};

/** 서로 다른 공급자의 정류장 ID 체계를 도착 API 요청 필드로 분리한다. */
export function getBusArrivalStationIdentifiers(
    passStops: TransitPassStopIdentifier[] | undefined,
    stationName?: string
): BusArrivalStationIdentifiers {
    const rawCodes = passStops
        ?.map((stop) => stop.code?.trim())
        .filter((code): code is string => !!code) ?? [];

    const explicitArsId = rawCodes
        .map((code) => code.match(/^ARS[:|-](\d{5})$/i)?.[1])
        .find((code): code is string => !!code);
    const cityNode = rawCodes
        .map((code) => code.match(/^(\d{2,5})[:|-](.+)$/))
        .find((match): match is RegExpMatchArray => !!match?.[1] && !!match?.[2]);
    const legacyArsId = rawCodes.find((code) => /^\d{5}$/.test(code));
    const standaloneNodeId = rawCodes.find((code) => /[A-Za-z]/.test(code) && /\d/.test(code));

    return {
        arsId: explicitArsId ?? legacyArsId,
        cityCode: cityNode?.[1],
        nodeId: cityNode?.[2] ?? standaloneNodeId,
        stationName: stationName?.replace(/\s+/g, " ").trim() || undefined,
    };
}

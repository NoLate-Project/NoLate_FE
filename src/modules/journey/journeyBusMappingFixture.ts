import { parseTransitOptionsFromOdsay } from "../map/odsayApi";

/** Mapping-only synthetic ODsay metadata. GPS uses the separately labelled existing TMAP shape. */
export function syntheticBusMappingRoute() {
    const stations = [126.9795, 126.9845, 126.9895].map((x, index) => ({ index: index + 10,
        stationName: `합성 정류장 ${index + 1}`, localStationID: String(999996 - index), arsID: `99-${999 - index}`,
        stationCityCode: "1000", stationProviderCode: "4", x, y: 37.5665 }));
    const [route] = parseTransitOptionsFromOdsay({ result: { paths: [{ pathType: 2, totalTime: 8, rps: [
        { trafficType: 3, duration: 3, startX: 126.978, startY: 37.5665, endX: 126.9795, endY: 37.5665 },
        { trafficType: 2, duration: 5, stationCount: 2, startX: 126.9795, startY: 37.5665, endX: 126.9895, endY: 37.5665,
            startLocalStationID: "999996", startArsID: "99-999", startStationCityCode: "1000", startStationProviderCode: "4",
            way: "합성 동쪽 방면", lane: [{ busID: "888888", busLocalBlID: "999999", busCityCode: "1000", busProviderCode: "4", busNo: "합성 버스" }],
            graph: "126.9795 37.5665|126.9845 37.5665|126.9895 37.5665", passStopList: { stations } },
    ] }] } });
    if (!route) throw new Error("INVALID_SYNTHETIC_BUS_MAPPING");
    return route;
}

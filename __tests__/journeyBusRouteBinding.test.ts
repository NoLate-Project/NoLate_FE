import { syntheticBusMappingRoute } from "../src/modules/journey/journeyBusMappingFixture";
import { projectJourneyBusBinding, resolveJourneyBusRouteMapping } from "../src/modules/journey/journeyBusRouteBinding";
import type { AutomaticJourneyBinding } from "../src/modules/journey/automaticJourney";
jest.mock("../src/api/env", () => ({ getEnv: () => { throw new Error("NO_KEYS"); } }));
const binding = { sessionId: "fixture", generation: 1, routeRevision: 1, routeInputDigest: "a".repeat(64) } as AutomaticJourneyBinding;
function route() { return JSON.parse(JSON.stringify(syntheticBusMappingRoute())); }
function response() { return { success: true, data: { ...binding, schemaVersion: 1, identityEvidence: "SAVED_ROUTE_METADATA", mapping: resolveJourneyBusRouteMapping(route()) } }; }
test("production ODsay parser preserves raw namespaces and uses local BIS ID not busID", () => {
    const parsed = route(), mapping = resolveJourneyBusRouteMapping(parsed);
    expect(parsed.transitLegs[1].providerRouteId).toBe("888888");
    expect(mapping).toEqual({ status: "SUPPORTED", query: { namespace: "SEOUL_BUS", arsId: "99999", providerRouteId: "999999", directionLabel: "합성 동쪽 방면", legIndex: 1 },
        boarding: { sourceIndex: 0, providerSequence: 10, localStationId: "999996", latitude: 37.5665, longitude: 126.9795 } });
    expect(parsed.transitLegs[0].navigationEvidence.geometryInputComplete).toBe(false); // Mapping never repairs WALK geometry.
});
test.each(["localRouteId", "startArsID", "startLocalStationID", "routeCityCode", "routeProviderCode", "startStationCityCode", "startStationProviderCode", "navigationEvidence", "startCoord"])("missing %s blocks mapping", field => {
    const value = route(); delete value.transitLegs[1][field]; expect(resolveJourneyBusRouteMapping(value).query).toBeNull();
});
test.each(["99x999", "9999", "999999", " 99999", "99/999", "00000"])("ARS %s is not stripped or padded", value => {
    const r = route(); r.transitLegs[1].startArsID = value; expect(resolveJourneyBusRouteMapping(r).query).toBeNull();
});
test.each(["0", " 999999", "999999\n", "999999999999999999999"])("local route %s rejected", value => {
    const r = route(); r.transitLegs[1].localRouteId = value; expect(resolveJourneyBusRouteMapping(r).query).toBeNull();
});
test.each(["", " ", "bad\n", "x".repeat(129)])("raw direction required and display fallback ignored: %s", value => {
    const r = route(); r.transitLegs[1].directionName = "display fallback"; r.transitLegs[1].navigationEvidence.directionName = value;
    expect(resolveJourneyBusRouteMapping(r).status).toBe("DIRECTION_REQUIRED");
});
test.each(["sequence", "reversed", "sourceIndex", "sourceIndexString", "coordinate", "count", "localID", "ars", "city", "provider", "repeated", "far", "rawIDs", "missingMiddleID"])("bad occurrence %s never repaired from display stops", mode => {
    const r = route(), bus = r.transitLegs[1], e = bus.navigationEvidence, first = e.stopOccurrences[0], middle = e.stopOccurrences[1];
    switch (mode) {
        case "sequence": delete first.providerSequence; break;
        case "reversed": middle.providerSequence = 9; break;
        case "sourceIndex": first.sourceIndex = 1; break;
        case "sourceIndexString": first.sourceIndex = "0"; break;
        case "coordinate": first.coord.lat = 95; break;
        case "count": e.declaredStationCount = 3; break;
        case "localID": first.localStationID = "999995"; break;
        case "ars": first.arsID = "99-998"; break;
        case "city": first.stationCityCode = "2"; break;
        case "provider": first.stationProviderCode = "2"; break;
        case "repeated": middle.localStationID = first.localStationID; break;
        case "far": bus.startCoord.lat += .001; break;
        case "rawIDs": e.busIdentifiers.localRouteId = " 999999"; break;
        case "missingMiddleID": delete middle.localStationID; break;
    }
    expect(resolveJourneyBusRouteMapping(r).query).toBeNull();
});
test("unmapped TMAP, multiple route arrays and conflicting wrapper metadata are blocked", () => {
    const r = route(); expect(resolveJourneyBusRouteMapping({ ...r, provider: "tmap" }).status).toBe("UNSUPPORTED_PROVIDER");
    expect(resolveJourneyBusRouteMapping({ ...r, routeInfo: r }).status).toBe("AMBIGUOUS_ROUTE_SNAPSHOT");
    expect(resolveJourneyBusRouteMapping({ routeInfo: r }).status).toBe("SUPPORTED");
    expect(resolveJourneyBusRouteMapping({ provider: "tmap", routeInfo: r }).status).toBe("AMBIGUOUS_ROUTE_SNAPSHOT");
});
test.each(["sessionId", "generation", "routeRevision", "routeInputDigest", "schemaVersion", "identityEvidence"])("server binding changed %s rejected", key => {
    const r = response(); Object.assign(r.data, { [key]: "bad" });
    expect(projectJourneyBusBinding(r, binding, resolveJourneyBusRouteMapping(route())).status).toBe("BINDING_RESPONSE_REJECTED");
});
test.each(["providerRouteId", "arsId", "directionLabel", "namespace", "legIndex"])("server selected %s mismatch rejected", key => {
    const r = response(); Object.assign(r.data.mapping.query!, { [key]: "other" });
    expect(projectJourneyBusBinding(r, binding, resolveJourneyBusRouteMapping(route())).status).toBe("SELECTED_SAVED_ROUTE_MISMATCH");
});
test.each(["sourceIndex", "providerSequence", "localStationId", "latitude", "longitude"])("server selected occurrence %s mismatch rejected", key => {
    const r = response(); Object.assign(r.data.mapping.boarding!, { [key]: "other" });
    expect(projectJourneyBusBinding(r, binding, resolveJourneyBusRouteMapping(route())).status).toBe("SELECTED_SAVED_ROUTE_MISMATCH");
});
test("valid fenced binding and unsupported server mapping are distinct", () => {
    const r = response(), selected = resolveJourneyBusRouteMapping(route());
    expect(projectJourneyBusBinding(r, binding, selected)).toEqual(selected);
    r.data.mapping = { status: "LOCAL_ROUTE_ID_REQUIRED", query: null, boarding: null };
    expect(projectJourneyBusBinding(r, binding, selected).status).toBe("SAVED_ROUTE_MAPPING_UNAVAILABLE");
});

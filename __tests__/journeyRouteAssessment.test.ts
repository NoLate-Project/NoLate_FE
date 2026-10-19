import { Platform } from "react-native";

import {
    assessJourneyRouteInput, normalizeJourneyRouteAssessment,
} from "../src/modules/journey/journeyRouteAssessment";
import { JOURNEY_ROUTE_INPUT_LIMITS, type JourneyRouteInput } from "../src/modules/journey/journeyRouteInput";

const mockNative = { assessJourneyRouteInput: jest.fn(), armJourneyEngine: jest.fn(), startJourneySession: jest.fn() };
const mockRequire = jest.fn((_name: string) => mockNative);
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: (name: string) => mockRequire(name) }), { virtual: true });
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalDev = runtime.__DEV__;
const originalOS = Platform.OS;
const inputFixture = (): JourneyRouteInput => ({
    schemaVersion: 1, routeRevision: 9, context: "ROUTING_RESPONSE", provider: "tmap", source: "api",
    reliability: "live_provider", plausibility: "normal", serviceState: "operating",
    origin: { latitude: 37.5665, longitude: 126.978 }, destination: { latitude: 37.5665, longitude: 126.98 },
    legs: [{
        index: 0, kind: "WALK", geometrySource: "provider_shape", geometryInputComplete: true, exact: true,
        coordinates: [{ latitude: 37.5665, longitude: 126.978 }, { latitude: 37.5665, longitude: 126.98 }],
        start: { latitude: 37.5665, longitude: 126.978 }, end: { latitude: 37.5665, longitude: 126.98 },
        providerRouteId: "private-provider-id", localRouteId: "private-local-id", directionName: null, directionCode: null,
        serviceAvailable: true, declaredStationCount: null, stopEvidenceProvider: null, stopEvidenceVersion: null, stops: [],
    }],
});
const summaryFor = (input: JourneyRouteInput, patch: Record<string, unknown> = {}, legPatch: Record<string, unknown> = {}) => ({
    schemaVersion: 1, routeRevision: input.routeRevision, context: input.context, provider: input.provider,
    evaluationMode: "READ_ONLY", fullAutomaticGuidance: false, fieldValidated: false,
    eligibleDepartureLegIndex: null, reasonCodes: ["FIELD_VALIDATION_REQUIRED"],
    legs: input.legs.map((leg, index) => ({
        index, kind: leg.kind, geometryUsable: true, stopSequenceUsable: false, directionExplicit: false,
        rideNavigationEligible: false, geometryLengthMeters: 176.2, shapePointCount: leg.coordinates.length,
        stopCount: leg.stops.length, reasonCodes: ["STOP_EVIDENCE_UNAVAILABLE"], ...legPatch,
    })), ...patch,
});
const responseFor = (input: JourneyRouteInput, patch: Record<string, unknown> = {}, legPatch: Record<string, unknown> = {}) => ({
    available: true, summaryJSON: JSON.stringify(summaryFor(input, patch, legPatch)),
});
const invalid = { available: false, reason: "INVALID_NATIVE_ASSESSMENT" };

describe("P1-2 assessment response contract", () => {
    it("accepts the exact read-only summary and preserves all rejection reason codes", () => {
        const input = inputFixture();
        const result = normalizeJourneyRouteAssessment(responseFor(input), input);
        expect(result).toEqual({ available: true, summary: summaryFor(input) });
    });

    it("strips raw coordinates, stop names, IDs and unexpected native fields from the public result", () => {
        const input = inputFixture();
        const response = responseFor(input, {
            token: "private-token", coordinates: input.legs[0].coordinates, providerRouteId: "private-id",
        }, { stopName: "private-stop", coordinate: input.origin, deviceId: "private-device" });
        const result = normalizeJourneyRouteAssessment(response, input);
        expect(result.available).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/private-|latitude|longitude|coordinates|stopName|deviceId|providerRouteId/);
    });

    it.each([
        null, undefined, [], {}, { available: "true" }, { available: true },
        { available: true, summaryJSON: {} }, { available: true, summaryJSON: "{" },
        { available: true, summaryJSON: "null" }, { available: true, summaryJSON: "[]" },
    ])("rejects malformed native envelope %#", response => {
        expect(normalizeJourneyRouteAssessment(response, inputFixture())).toEqual(invalid);
    });

    it.each([
        ["schemaVersion", 2], ["routeRevision", 10], ["routeRevision", 9.1], ["routeRevision", -1],
        ["context", "SAVED_ROUTE"], ["provider", "odsay"], ["evaluationMode", "ACTIVE"],
        ["fullAutomaticGuidance", true], ["fullAutomaticGuidance", undefined], ["fieldValidated", true],
        ["fieldValidated", undefined], ["reasonCodes", ["coordinate=37.5"]], ["reasonCodes", "READY"],
        ["reasonCodes", Array.from({ length: 129 }, () => "REASON")], ["reasonCodes", ["A".repeat(97)]],
        ["legs", []], ["legs", null], ["legs", [null]],
    ] as const)("rejects mismatched or unsafe summary %s %#", (key, value) => {
        const input = inputFixture();
        expect(normalizeJourneyRouteAssessment(responseFor(input, { [key]: value }), input)).toEqual(invalid);
    });

    it.each([
        ["index", 1], ["kind", "BUS"], ["geometryUsable", 1], ["stopSequenceUsable", "true"],
        ["directionExplicit", null], ["rideNavigationEligible", undefined], ["shapePointCount", 1],
        ["shapePointCount", 2.1], ["stopCount", 1], ["geometryLengthMeters", -1],
        ["geometryLengthMeters", 100_000_001], ["geometryLengthMeters", "176.2"],
        ["reasonCodes", ["private latitude"]], ["reasonCodes", undefined],
    ] as const)("rejects mismatched or unsafe leg %s %#", (key, value) => {
        const input = inputFixture();
        expect(normalizeJourneyRouteAssessment(responseFor(input, {}, { [key]: value }), input)).toEqual(invalid);
    });

    it("rejects a JSON number that overflows to an infinite length", () => {
        const input = inputFixture();
        const response = responseFor(input);
        response.summaryJSON = response.summaryJSON.replace('"geometryLengthMeters":176.2', '"geometryLengthMeters":1e309');
        expect(normalizeJourneyRouteAssessment(response, input)).toEqual(invalid);
    });

    it("permits a missing measured length without replacing it with zero", () => {
        const input = inputFixture();
        const result = normalizeJourneyRouteAssessment(responseFor(input, {}, { geometryLengthMeters: null }), input);
        expect(result.available && result.summary.legs[0].geometryLengthMeters).toBeNull();
    });

    it("permits only the first valid walking leg as a departure candidate on a routing response", () => {
        const input = inputFixture();
        const result = normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: 0, reasonCodes: [] }), input);
        expect(result.available && result.summary.eligibleDepartureLegIndex).toBe(0);
        for (const candidate of [-1, 0.5, 1, "0"]) {
            expect(normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: candidate, reasonCodes: [] }), input)).toEqual(invalid);
        }
        expect(normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: 0, reasonCodes: [] }, { geometryUsable: false }), input)).toEqual(invalid);
        input.legs[0].kind = "BUS";
        expect(normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: 0, reasonCodes: [] }), input)).toEqual(invalid);
    });

    it.each(["SYNTHETIC_FIXTURE", "SAVED_ROUTE"] as const)("does not accept departure eligibility in %s", context => {
        const input = inputFixture();
        input.context = context;
        expect(normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: 0, reasonCodes: [] }), input)).toEqual(invalid);
    });

    it("rejects departure eligibility when route rejection reasons are present", () => {
        const input = inputFixture();
        expect(normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: 0 }), input)).toEqual(invalid);
    });

    it.each([null, 0, 69.9, 100_000.1])("rejects departure eligibility with an unusable walking length %s", geometryLengthMeters => {
        const input = inputFixture();
        expect(normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: 0, reasonCodes: [] }, { geometryLengthMeters }), input)).toEqual(invalid);
    });

    it.each([70, 100_000])("accepts departure eligibility at the inclusive native length boundary %s", geometryLengthMeters => {
        const input = inputFixture();
        const result = normalizeJourneyRouteAssessment(responseFor(input, { eligibleDepartureLegIndex: 0, reasonCodes: [] }, { geometryLengthMeters }), input);
        expect(result.available && result.summary.eligibleDepartureLegIndex).toBe(0);
    });

    it.each(["BUS", "SUBWAY"] as const)("accepts consistent %s ride eligibility despite a later first-walk rejection", kind => {
        const input = inputFixture();
        input.legs[0].kind = kind;
        const result = normalizeJourneyRouteAssessment(responseFor(input, { reasonCodes: ["FIRST_LEG_NOT_WALK"] }, {
            rideNavigationEligible: true, geometryUsable: true, stopSequenceUsable: true, directionExplicit: true, reasonCodes: [],
        }), input);
        expect(result.available && result.summary.legs[0].rideNavigationEligible).toBe(true);
    });

    it.each([
        ["geometryUsable", false], ["stopSequenceUsable", false], ["directionExplicit", false],
        ["reasonCodes", ["STOP_SEQUENCE_UNVERIFIED"]],
    ] as const)("rejects ride eligibility contradictory to %s", (key, value) => {
        const input = inputFixture();
        input.legs[0].kind = "BUS";
        expect(normalizeJourneyRouteAssessment(responseFor(input, {}, {
            rideNavigationEligible: true, geometryUsable: true, stopSequenceUsable: true, directionExplicit: true,
            reasonCodes: [], [key]: value,
        }), input)).toEqual(invalid);
    });

    it.each(["WALK", "ETC", "UNKNOWN"] as const)("rejects ride eligibility for non-ride kind %s", kind => {
        const input = inputFixture();
        input.legs[0].kind = kind;
        expect(normalizeJourneyRouteAssessment(responseFor(input, {}, {
            rideNavigationEligible: true, geometryUsable: true, stopSequenceUsable: true, directionExplicit: true, reasonCodes: [],
        }), input)).toEqual(invalid);
    });

    it.each(["SYNTHETIC_FIXTURE", "SAVED_ROUTE"] as const)("rejects ride eligibility in %s context", context => {
        const input = inputFixture();
        input.context = context;
        input.legs[0].kind = "BUS";
        expect(normalizeJourneyRouteAssessment(responseFor(input, {}, {
            rideNavigationEligible: true, geometryUsable: true, stopSequenceUsable: true, directionExplicit: true, reasonCodes: [],
        }), input)).toEqual(invalid);
    });

    it("returns only safe uppercase reason codes for native unavailability", () => {
        const input = inputFixture();
        expect(normalizeJourneyRouteAssessment({ available: false, reason: "NATIVE_REBUILD_REQUIRED", token: "private" }, input)).toEqual({ available: false, reason: "NATIVE_REBUILD_REQUIRED" });
        for (const reason of ["private latitude=37.5", "a", "A".repeat(97), null, 42]) {
            expect(normalizeJourneyRouteAssessment({ available: false, reason }, input)).toEqual({ available: false, reason: "ASSESSMENT_UNAVAILABLE" });
        }
    });

    it("enforces the native JSON response byte limit, including multi-byte text", () => {
        const input = inputFixture();
        for (const summaryJSON of ["a".repeat(JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes + 1), "가".repeat(350_000)]) {
            expect(normalizeJourneyRouteAssessment({ available: true, summaryJSON }, input)).toEqual(invalid);
        }
    });
});

describe("P1-2 development assessment bridge", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        runtime.__DEV__ = true;
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        mockRequire.mockReturnValue(mockNative);
        mockNative.assessJourneyRouteInput.mockImplementation(async (json: string) => responseFor(JSON.parse(json)));
    });
    afterEach(() => {
        runtime.__DEV__ = originalDev;
        Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
    });

    it("only sends bounded JSON to the read-only native assessment method", async () => {
        const input = inputFixture();
        const result = await assessJourneyRouteInput(input);
        expect(mockRequire).toHaveBeenCalledWith("NoLateLiveActivity");
        expect(mockNative.assessJourneyRouteInput).toHaveBeenCalledWith(JSON.stringify(input));
        expect(result.available).toBe(true);
        expect(mockNative.armJourneyEngine).not.toHaveBeenCalled();
        expect(mockNative.startJourneySession).not.toHaveBeenCalled();
    });

    it("never resolves the native module in release", async () => {
        runtime.__DEV__ = false;
        expect(await assessJourneyRouteInput(inputFixture())).toEqual({ available: false, reason: "DEVELOPMENT_IOS_ONLY" });
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("never resolves the iOS module on Android", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        expect(await assessJourneyRouteInput(inputFixture())).toEqual({ available: false, reason: "DEVELOPMENT_IOS_ONLY" });
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("reports an absent native module or method as requiring a rebuild", async () => {
        mockRequire.mockReturnValue(null as unknown as typeof mockNative);
        expect(await assessJourneyRouteInput(inputFixture())).toEqual({ available: false, reason: "NATIVE_REBUILD_REQUIRED" });
        mockRequire.mockReturnValue({} as typeof mockNative);
        expect(await assessJourneyRouteInput(inputFixture())).toEqual({ available: false, reason: "NATIVE_REBUILD_REQUIRED" });
    });

    it("hides native rejection and module-resolution exceptions", async () => {
        mockNative.assessJourneyRouteInput.mockRejectedValue(new Error("private latitude=37.5665 token=secret"));
        expect(await assessJourneyRouteInput(inputFixture())).toEqual({ available: false, reason: "ASSESSMENT_UNAVAILABLE" });
        mockRequire.mockImplementationOnce(() => { throw new Error("private error"); });
        expect(await assessJourneyRouteInput(inputFixture())).toEqual({ available: false, reason: "ASSESSMENT_UNAVAILABLE" });
    });

    it.each([null, {}, { legs: "invalid" }, { legs: Array.from({ length: 33 }, () => ({})) }])("rejects malformed or oversized leg arrays before native module resolution %#", async input => {
        expect(await assessJourneyRouteInput(input as JourneyRouteInput)).toEqual({ available: false, reason: "INVALID_ROUTE_INPUT" });
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("rejects an oversized serialized request before native module resolution", async () => {
        const input = { ...inputFixture(), untrusted: "가".repeat(350_000) };
        expect(await assessJourneyRouteInput(input)).toEqual({ available: false, reason: "INPUT_LIMIT_EXCEEDED" });
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("hides serialization failures without exposing raw input", async () => {
        const input = inputFixture() as JourneyRouteInput & { circular?: unknown };
        input.circular = input;
        expect(await assessJourneyRouteInput(input)).toEqual({ available: false, reason: "ASSESSMENT_UNAVAILABLE" });
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("validates asynchronous responses against the exact payload sent before caller mutation", async () => {
        const input = inputFixture();
        let complete!: (response: unknown) => void;
        mockNative.assessJourneyRouteInput.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const pending = assessJourneyRouteInput(input);
        const sent = JSON.parse(mockNative.assessJourneyRouteInput.mock.calls[0][0]) as JourneyRouteInput;
        input.routeRevision = 999;
        input.context = "SAVED_ROUTE";
        input.provider = "odsay";
        input.legs[0].coordinates.push(null);
        complete(responseFor(sent));
        const result = await pending;
        expect(result.available && result.summary.routeRevision).toBe(9);
        expect(result.available && result.summary.context).toBe("ROUTING_RESPONSE");
        expect(result.available && result.summary.legs[0].shapePointCount).toBe(2);
    });

    it("rejects a response matching only the caller-mutated input instead of the sent payload", async () => {
        const input = inputFixture();
        let complete!: (response: unknown) => void;
        mockNative.assessJourneyRouteInput.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const pending = assessJourneyRouteInput(input);
        input.routeRevision = 999;
        complete(responseFor(input));
        expect(await pending).toEqual(invalid);
    });
});

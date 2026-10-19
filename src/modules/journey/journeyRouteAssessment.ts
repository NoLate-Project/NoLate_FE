import { Platform } from "react-native";

import { JOURNEY_ROUTE_INPUT_LIMITS, journeyRouteUTF8Bytes, type JourneyRouteInput } from "./journeyRouteInput";

export type JourneyRouteLegAssessment = {
    index: number;
    kind: string;
    geometryUsable: boolean;
    stopSequenceUsable: boolean;
    directionExplicit: boolean;
    rideNavigationEligible: boolean;
    geometryLengthMeters: number | null;
    shapePointCount: number;
    stopCount: number;
    reasonCodes: string[];
};
export type JourneyRouteAssessmentSummary = {
    schemaVersion: 1;
    routeRevision: number;
    context: JourneyRouteInput["context"];
    provider: JourneyRouteInput["provider"];
    evaluationMode: "READ_ONLY";
    fullAutomaticGuidance: false;
    fieldValidated: false;
    eligibleDepartureLegIndex: number | null;
    reasonCodes: string[];
    legs: JourneyRouteLegAssessment[];
};
export type JourneyRouteAssessmentResult =
    | { available: true; summary: JourneyRouteAssessmentSummary }
    | { available: false; reason: string };

const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const code = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value);
const codes = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 128 && value.every(code);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const invalid = (): JourneyRouteAssessmentResult => ({ available: false, reason: "INVALID_NATIVE_ASSESSMENT" });

/** Fail closed, preserving all rejection reasons; no raw paths, stops, IDs, or native exceptions escape. */
export function normalizeJourneyRouteAssessment(value: unknown, input: JourneyRouteInput): JourneyRouteAssessmentResult {
    try {
        const response = record(value);
        if (response?.available === false) return { available: false, reason: code(response.reason) ? response.reason : "ASSESSMENT_UNAVAILABLE" };
        if (response?.available !== true || typeof response.summaryJSON !== "string"
            || response.summaryJSON.length > JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes
            || journeyRouteUTF8Bytes(response.summaryJSON) > JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes) return invalid();
        const summary = record(JSON.parse(response.summaryJSON));
        if (!summary || summary.schemaVersion !== 1 || !integer(summary.routeRevision)
            || summary.routeRevision !== input.routeRevision || summary.context !== input.context || summary.provider !== input.provider
            || summary.evaluationMode !== "READ_ONLY" || summary.fullAutomaticGuidance !== false || summary.fieldValidated !== false
            || !codes(summary.reasonCodes) || !Array.isArray(summary.legs) || summary.legs.length !== input.legs.length) return invalid();
        const legs: JourneyRouteLegAssessment[] = [];
        for (let index = 0; index < summary.legs.length; index += 1) {
            const leg = record(summary.legs[index]);
            const expected = input.legs[index];
            if (!leg || leg.index !== index || leg.kind !== expected.kind
                || ![leg.geometryUsable, leg.stopSequenceUsable, leg.directionExplicit, leg.rideNavigationEligible].every(v => typeof v === "boolean")
                || leg.shapePointCount !== expected.coordinates.length || leg.stopCount !== expected.stops.length
                || !codes(leg.reasonCodes) || !(leg.geometryLengthMeters === null || (typeof leg.geometryLengthMeters === "number"
                    && Number.isFinite(leg.geometryLengthMeters) && leg.geometryLengthMeters >= 0 && leg.geometryLengthMeters <= 100_000_000))) return invalid();
            // Eligibility cannot contradict the same leg's evidence. Route-level first-walk
            // reasons are added after native ride evaluation, so they are not a ride gate here.
            if (leg.rideNavigationEligible && (input.context !== "ROUTING_RESPONSE"
                || !["BUS", "SUBWAY"].includes(expected.kind) || !leg.geometryUsable
                || !leg.stopSequenceUsable || !leg.directionExplicit || leg.reasonCodes.length !== 0)) return invalid();
            legs.push({
                index, kind: expected.kind, geometryUsable: leg.geometryUsable as boolean,
                stopSequenceUsable: leg.stopSequenceUsable as boolean, directionExplicit: leg.directionExplicit as boolean,
                rideNavigationEligible: leg.rideNavigationEligible as boolean,
                geometryLengthMeters: leg.geometryLengthMeters as number | null,
                shapePointCount: leg.shapePointCount as number, stopCount: leg.stopCount as number,
                reasonCodes: [...leg.reasonCodes],
            });
        }
        const departureIndex = summary.eligibleDepartureLegIndex;
        const departureLeg = legs[0];
        if (!(departureIndex === null || (integer(departureIndex) && departureIndex === 0
            && input.context === "ROUTING_RESPONSE" && summary.reasonCodes.length === 0
            && departureLeg?.kind === "WALK" && departureLeg.geometryUsable
            && typeof departureLeg.geometryLengthMeters === "number"
            && departureLeg.geometryLengthMeters >= 70 && departureLeg.geometryLengthMeters <= 100_000))) return invalid();
        return { available: true, summary: {
            schemaVersion: 1, routeRevision: input.routeRevision, context: input.context, provider: input.provider,
            evaluationMode: "READ_ONLY", fullAutomaticGuidance: false, fieldValidated: false,
            eligibleDepartureLegIndex: departureIndex, reasonCodes: [...summary.reasonCodes], legs,
        } };
    } catch { return invalid(); }
}

/** Read-only development bridge: deliberately separate from arm/start and the location runtime. */
export async function assessJourneyRouteInput(input: JourneyRouteInput): Promise<JourneyRouteAssessmentResult> {
    if (!__DEV__ || Platform.OS !== "ios") return { available: false, reason: "DEVELOPMENT_IOS_ONLY" };
    try {
        if (!input || !Array.isArray(input.legs) || input.legs.length > JOURNEY_ROUTE_INPUT_LIMITS.legs) {
            return { available: false, reason: "INVALID_ROUTE_INPUT" };
        }
        const json = JSON.stringify(input);
        if (journeyRouteUTF8Bytes(json) > JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes) return { available: false, reason: "INPUT_LIMIT_EXCEEDED" };
        // Fence validation to precisely the payload sent, even if the caller later mutates its input.
        const expectedInput = JSON.parse(json) as JourneyRouteInput;
        const { requireOptionalNativeModule } = require("expo-modules-core");
        const native = requireOptionalNativeModule("NoLateLiveActivity") as {
            assessJourneyRouteInput?: (json: string) => Promise<unknown>;
        } | null;
        if (typeof native?.assessJourneyRouteInput !== "function") return { available: false, reason: "NATIVE_REBUILD_REQUIRED" };
        return normalizeJourneyRouteAssessment(await native.assessJourneyRouteInput(json), expectedInput);
    } catch {
        return { available: false, reason: "ASSESSMENT_UNAVAILABLE" };
    }
}

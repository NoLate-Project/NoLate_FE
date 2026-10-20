import { Platform } from "react-native";
import { journeyAuthenticationOrigin, journeyLoginGeneration, type JourneyAuthentication } from "./automaticJourneyAuthentication";

/** Explicit development execution boundary. Neither a device identifier nor an authentication credential. */
export type AutomaticJourneyBinding = {
    sessionId: string; scheduleId: string; generation: number; routeRevision: number;
    clientOwnerId: string; routeInputDigest: string;
    preparedAtEpochSeconds: number; expiresAtEpochSeconds: number;
    execution: "SIMULATOR" | "DEVICE"; syncScope: "LOCAL_ONLY" | "SANDBOX" | "AUTHENTICATED";
    apiOrigin?: string; authMemberId?: number; loginGeneration?: number;
    savedRouteValidated?: true; guidanceEnabled?: true;
};
export type AutomaticJourneyDeparture = Pick<AutomaticJourneyBinding,
    "sessionId" | "scheduleId" | "generation" | "routeRevision" | "clientOwnerId" | "routeInputDigest" | "execution"
> & { schemaVersion: 1; eventKey: string; sequence: 1; type: "AUTO_DEPARTURE"; occurredAtEpochSeconds: number };
export type AutomaticJourneySnapshot = {
    guidanceNoticeMode?: string; guidanceNoticeState?: string; guidanceNoticePermission?: string;
    guidanceNoticeScheduledCount?: number; guidanceVoiceQueuedCount?: number;
    enabled: boolean; reason: string | null;
    status: "IDLE" | "ARMED" | "ACTIVE" | "STOPPED" | "EXPIRED";
    sessionId: string | null; routeRevision: number | null;
    alongRouteMeters: number | null; crossTrackMeters: number | null; departureCount: number;
    quality: string; qualityReason: string; locationState: string; authorization: string;
    pendingDeparture: boolean; departureAcknowledged: boolean;
    syncScope: "NONE" | "LOCAL_ONLY" | "SANDBOX" | "AUTHENTICATED";
    remainingSeconds: number; lastErrorCode: string | null; checkpointAvailable: boolean;
    /** P2-1 is candidate inference only; missing older-native fields are normalized unavailable. */
    busPhase?: "WALKING_TO_STOP" | "APPROACHING_STOP" | "WAITING" | "BOARDING_CANDIDATE" | "UNAVAILABLE";
    busQuality?: "GOOD" | "UNCERTAIN" | "UNAVAILABLE";
    busReason?: string;
    distanceToBoardMeters?: number | null;
    busAlongRouteMeters?: number | null;
    busLastAccuracyMeters?: number | null;
    boardingEvidenceCount?: number;
    boardingConfirmed?: false;
    /** Separate R2 native diagnostics. Not admission to detail/Activity riding UI. */
    ridePhase?: string;
    rideQuality?: string;
    rideReason?: string;
    rideEvidenceCount?: number;
    rideTransportState?: string;
    subwayTransportState?: string;
    subwayPhase?: string;
    subwayReason?: string;
    separationStatus?: "UNAVAILABLE" | "COLLECTING" | "SEPARATION_OBSERVED";
    separationReason?: string;
    separationEvidenceCount?: number;
    transferWalkPhase?: string;
    transferWalkReason?: string;
    transferWalkEvidenceCount?: number;
    finalWalkPhase?: 'UNAVAILABLE' | 'COLLECTING' | 'FINAL_WALK';
    finalWalkReason?: string;
    finalWalkEvidenceCount?: number;
    destinationEvidenceCount?: number;
    guidance?: Record<string, unknown> | null;
    guidanceRoute?: Record<string, unknown> | null;
    guidancePosition?: Record<string, unknown> | null;
    guidanceActivityState?: string;
    guidanceActivityError?: string | null;
    guidancePushState?: string;
    guidancePushTokenAvailable?: boolean;
    guidancePushProviderAcceptedCount?: number;
};

export const automaticRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const automaticUUID = (value: unknown): value is string => typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const automaticPositiveInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const metric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000_000 ? value : null;
const noticeCount = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0 && value <= 100_000 ? value : 0;
const safeCode = (value: unknown): string | null => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value) ? value : null;
const epoch = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 253_402_300_800;

export function normalizeAutomaticJourneyBinding(value: unknown): AutomaticJourneyBinding | null {
    const binding = automaticRecord(value);
    if (!binding || !automaticUUID(binding.sessionId) || !automaticUUID(binding.clientOwnerId)
        || typeof binding.scheduleId !== "string" || !/^[1-9]\d{0,17}$/.test(binding.scheduleId)
        || !automaticPositiveInteger(binding.generation) || !automaticPositiveInteger(binding.routeRevision)
        || typeof binding.routeInputDigest !== "string" || !/^[a-f0-9]{64}$/.test(binding.routeInputDigest)
        || !epoch(binding.preparedAtEpochSeconds) || !epoch(binding.expiresAtEpochSeconds)
        || binding.expiresAtEpochSeconds <= binding.preparedAtEpochSeconds
        || binding.expiresAtEpochSeconds - binding.preparedAtEpochSeconds > (binding.syncScope === 'AUTHENTICATED' ? 7200.001 : 600.001)
        || !["SIMULATOR", "DEVICE"].includes(String(binding.execution))
        || binding.execution === "DEVICE" && binding.syncScope !== "AUTHENTICATED"
        || !["LOCAL_ONLY", "SANDBOX", "AUTHENTICATED"].includes(String(binding.syncScope))) return null;
    if (binding.syncScope === "AUTHENTICATED" && (!journeyAuthenticationOrigin(binding.apiOrigin)
        || !automaticPositiveInteger(binding.authMemberId) || !journeyLoginGeneration(binding.loginGeneration)
        || binding.savedRouteValidated !== true || binding.guidanceEnabled !== true)) return null;
    return {
        sessionId: binding.sessionId, scheduleId: binding.scheduleId, generation: binding.generation,
        routeRevision: binding.routeRevision, clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest,
        preparedAtEpochSeconds: binding.preparedAtEpochSeconds, expiresAtEpochSeconds: binding.expiresAtEpochSeconds,
        execution: binding.execution as AutomaticJourneyBinding["execution"], syncScope: binding.syncScope as AutomaticJourneyBinding["syncScope"],
        ...(binding.syncScope === "AUTHENTICATED" ? { apiOrigin: binding.apiOrigin as string,
            authMemberId: binding.authMemberId as number, loginGeneration: binding.loginGeneration as number } : {}),
        ...(binding.savedRouteValidated === true && binding.guidanceEnabled === true && binding.syncScope !== "LOCAL_ONLY"
            ? { savedRouteValidated: true as const, guidanceEnabled: true as const } : {}),
    };
}

export function normalizeAutomaticJourneySnapshot(value: unknown): AutomaticJourneySnapshot {
    const item = automaticRecord(value) ?? {};
    const validStatus = ["IDLE", "ARMED", "ACTIVE", "STOPPED", "EXPIRED"].includes(String(item.status));
    const validBusPhase = ["WALKING_TO_STOP", "APPROACHING_STOP", "WAITING", "BOARDING_CANDIDATE", "UNAVAILABLE"].includes(String(item.busPhase));
    const validBusQuality = ["GOOD", "UNCERTAIN", "UNAVAILABLE"].includes(String(item.busQuality));
    const busAvailable = item.enabled === true && validStatus && ["ARMED", "ACTIVE"].includes(String(item.status))
        && validBusPhase && validBusQuality && item.boardingConfirmed === false;
    const busMetric = (metricValue: unknown) => busAvailable && item.busQuality === "GOOD"
        && item.busPhase !== "UNAVAILABLE" && metric(metricValue) !== null && (metricValue as number) <= 100_000 ? metricValue as number : null;
    return {
        enabled: item.enabled === true && validStatus, reason: safeCode(item.reason),
        status: validStatus ? item.status as AutomaticJourneySnapshot["status"] : "IDLE",
        sessionId: automaticUUID(item.sessionId) ? item.sessionId : null,
        routeRevision: automaticPositiveInteger(item.routeRevision) ? item.routeRevision : null,
        alongRouteMeters: metric(item.alongRouteMeters), crossTrackMeters: metric(item.crossTrackMeters),
        departureCount: item.departureCount === 1 ? 1 : 0,
        quality: safeCode(item.quality) ?? "UNKNOWN", qualityReason: safeCode(item.qualityReason) ?? "UNKNOWN",
        locationState: safeCode(item.locationState) ?? "UNKNOWN", authorization: safeCode(item.authorization) ?? "UNKNOWN",
        pendingDeparture: item.pendingDeparture === true, departureAcknowledged: item.departureAcknowledged === true,
        syncScope: ["LOCAL_ONLY", "SANDBOX", "AUTHENTICATED"].includes(String(item.syncScope)) ? item.syncScope as AutomaticJourneySnapshot["syncScope"] : "NONE",
        remainingSeconds: metric(item.remainingSeconds) === null ? 0 : Math.min(item.syncScope === 'AUTHENTICATED' ? 7200 : 600, Math.floor(item.remainingSeconds as number)),
        lastErrorCode: safeCode(item.lastErrorCode), checkpointAvailable: item.checkpointAvailable === true,
        busPhase: busAvailable ? item.busPhase as AutomaticJourneySnapshot["busPhase"] : "UNAVAILABLE",
        busQuality: busAvailable ? item.busQuality as AutomaticJourneySnapshot["busQuality"] : "UNAVAILABLE",
        busReason: busAvailable ? safeCode(item.busReason) ?? "BUS_OBSERVATION_UNAVAILABLE" : "BUS_CAPABILITY_UNAVAILABLE",
        distanceToBoardMeters: busMetric(item.distanceToBoardMeters), busAlongRouteMeters: busMetric(item.busAlongRouteMeters),
        busLastAccuracyMeters: busMetric(item.busLastAccuracyMeters),
        boardingEvidenceCount: busAvailable && item.busQuality === "GOOD" && typeof item.boardingEvidenceCount === "number"
            && Number.isSafeInteger(item.boardingEvidenceCount) && item.boardingEvidenceCount >= 0 && item.boardingEvidenceCount <= 1000
            ? item.boardingEvidenceCount : 0,
        // Even a malformed/forward-version native snapshot cannot promote a GPS hypothesis to a confirmed ride.
        boardingConfirmed: false,
        ridePhase: safeCode(item.ridePhase) ?? "UNAVAILABLE",
        rideTransportState: safeCode(item.rideTransportState) ?? "NOT_REQUESTED",
        subwayTransportState: safeCode(item.subwayTransportState) ?? "NOT_REQUESTED",
        subwayPhase: safeCode(item.subwayPhase) ?? "UNAVAILABLE",
        subwayReason: safeCode(item.subwayReason) ?? "SUBWAY_INPUT_UNAVAILABLE",
        rideQuality: safeCode(item.rideQuality) ?? "UNAVAILABLE",
        rideReason: safeCode(item.rideReason) ?? "VERIFIED_RIDE_BINDING_UNAVAILABLE",
        separationStatus: ["UNAVAILABLE", "COLLECTING", "SEPARATION_OBSERVED"].includes(item.separationStatus as string)
            ? item.separationStatus as AutomaticJourneySnapshot["separationStatus"] : "UNAVAILABLE",
        separationReason: safeCode(item.separationReason) ?? "DEPARTURE_WINDOW_UNAVAILABLE",
        separationEvidenceCount: typeof item.separationEvidenceCount === "number" && Number.isSafeInteger(item.separationEvidenceCount)
            && item.separationEvidenceCount >= 0 && item.separationEvidenceCount <= 1000 ? item.separationEvidenceCount : 0,
        transferWalkPhase: safeCode(item.transferWalkPhase) ?? 'UNAVAILABLE',
        transferWalkReason: safeCode(item.transferWalkReason) ?? 'TRANSFER_WALK_GEOMETRY_UNAVAILABLE',
        transferWalkEvidenceCount: typeof item.transferWalkEvidenceCount === 'number' && Number.isSafeInteger(item.transferWalkEvidenceCount)
            && item.transferWalkEvidenceCount >= 0 && item.transferWalkEvidenceCount <= 1000 ? item.transferWalkEvidenceCount : 0,
        finalWalkPhase: ['UNAVAILABLE', 'COLLECTING', 'FINAL_WALK'].includes(item.finalWalkPhase as string)
            ? item.finalWalkPhase as AutomaticJourneySnapshot['finalWalkPhase'] : 'UNAVAILABLE',
        finalWalkReason: safeCode(item.finalWalkReason) ?? 'FINAL_WALK_GEOMETRY_UNAVAILABLE',
        destinationEvidenceCount: item.status === 'ACTIVE' && item.finalWalkPhase === 'FINAL_WALK'
            && typeof item.destinationEvidenceCount === 'number' && Number.isSafeInteger(item.destinationEvidenceCount)
            && item.destinationEvidenceCount >= 0 && item.destinationEvidenceCount <= 1000 ? item.destinationEvidenceCount : 0,
        finalWalkEvidenceCount: typeof item.finalWalkEvidenceCount === 'number' && Number.isSafeInteger(item.finalWalkEvidenceCount)
            && item.finalWalkEvidenceCount >= 0 && item.finalWalkEvidenceCount <= 1000 ? item.finalWalkEvidenceCount : 0,
        rideEvidenceCount: typeof item.rideEvidenceCount === "number" && Number.isSafeInteger(item.rideEvidenceCount)
            && item.rideEvidenceCount >= 0 && item.rideEvidenceCount <= 1000 ? item.rideEvidenceCount : 0,
        guidancePushState: safeCode(item.guidancePushState) ?? "OFF",
        guidancePushTokenAvailable: item.guidancePushTokenAvailable === true,
        guidancePushProviderAcceptedCount: automaticPositiveInteger(item.guidancePushProviderAcceptedCount)
            ? item.guidancePushProviderAcceptedCount as number : 0,
        ...(automaticRecord(item.guidance) ? { guidance: automaticRecord(item.guidance) } : {}),
        ...(automaticRecord(item.guidanceRoute) ? { guidanceRoute: automaticRecord(item.guidanceRoute) } : {}),
        ...(automaticRecord(item.guidancePosition) ? { guidancePosition: automaticRecord(item.guidancePosition) } : {}),
        ...(typeof item.guidanceNoticeMode === 'string' ? {
            guidanceNoticeMode: ['OFF', 'NOTIFICATIONS', 'VOICE_AND_NOTIFICATIONS'].includes(item.guidanceNoticeMode) ? item.guidanceNoticeMode : 'OFF',
            guidanceNoticeState: safeCode(item.guidanceNoticeState) ?? 'UNAVAILABLE',
            guidanceNoticePermission: safeCode(item.guidanceNoticePermission) ?? 'NOT_CHECKED',
            guidanceNoticeScheduledCount: noticeCount(item.guidanceNoticeScheduledCount),
            guidanceVoiceQueuedCount: noticeCount(item.guidanceVoiceQueuedCount),
        } : {}),
        ...(typeof item.guidanceActivityState === "string" ? {
            guidanceActivityState: safeCode(item.guidanceActivityState) ?? "UNKNOWN",
            guidanceActivityError: safeCode(item.guidanceActivityError),
        } : {}),
    };
}

export function normalizeAutomaticJourneyDeparture(value: unknown, binding: AutomaticJourneyBinding): AutomaticJourneyDeparture | null {
    const item = automaticRecord(value);
    const keys = ["sessionId", "scheduleId", "generation", "routeRevision", "clientOwnerId", "routeInputDigest", "execution"] as const;
    if (!item || item.schemaVersion !== 1 || item.type !== "AUTO_DEPARTURE" || item.sequence !== 1
        || keys.some(key => item[key] !== binding[key])
        || item.eventKey !== `${binding.sessionId}:${binding.generation}:${binding.routeRevision}:AUTO_DEPARTURE`
        || !epoch(item.occurredAtEpochSeconds) || item.occurredAtEpochSeconds < binding.preparedAtEpochSeconds
        || item.occurredAtEpochSeconds >= binding.expiresAtEpochSeconds) return null;
    return {
        schemaVersion: 1, sessionId: binding.sessionId, scheduleId: binding.scheduleId, generation: binding.generation,
        routeRevision: binding.routeRevision, clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest,
        execution: binding.execution, type: "AUTO_DEPARTURE", sequence: 1,
        eventKey: item.eventKey as string, occurredAtEpochSeconds: item.occurredAtEpochSeconds,
    };
}

type NativeAutomaticJourney = {
    configureAutomaticJourneyNoticeMode(mode: string): Promise<unknown>;
    configureAutomaticJourneyPushPilot(fcmToken: string): Promise<unknown>;
    refreshAutomaticJourneyCredentials(apiOrigin: string, refreshToken: string): Promise<unknown>;
    postAuthenticatedAutomaticJourney(authJSON: string, path: string, bodyJSON: string): Promise<unknown>;
    configureAutomaticJourneyAuthentication(authJSON: string): Promise<unknown>;
    updateAutomaticJourneyAuthentication(authJSON: string, bindingJSON: string, previousAccessToken: string): Promise<unknown>;
    getAutomaticJourneySnapshot(): Promise<unknown>;
    armAutomaticJourney(routeJSON: string, bindingJSON: string): Promise<unknown>;
    restoreAutomaticJourney(routeJSON: string, bindingJSON: string): Promise<unknown>;
    stopAutomaticJourney(): Promise<unknown>;
    reconcileAutomaticJourneyTerminal(bindingJSON: string): Promise<unknown>;
    getAutomaticJourneyDeparture(): Promise<unknown>;
    acknowledgeAutomaticJourneyDeparture(eventKey: string, bindingJSON: string): Promise<unknown>;
    addListener(event: string, listener: (value: unknown) => void): { remove(): void };
};
/** The product build is independently fenced again by the native Info.plist. */
function productBuildRequested(): boolean {
    try {
        const env = require("../../api/env") as typeof import("../../api/env");
        return env.getEnv("EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED") === "true";
    } catch {
        return false;
    }
}
export const isAutomaticJourneyDevelopment = () => Platform.OS === "ios"
    && (__DEV__ || productBuildRequested());
function nativeAutomaticJourney(): NativeAutomaticJourney | null {
    const { requireOptionalNativeModule } = require("expo-modules-core");
    return requireOptionalNativeModule("NoLateLiveActivity") as NativeAutomaticJourney | null;
}
async function invoke(method: Exclude<keyof NativeAutomaticJourney, "addListener">, args: string[] = []): Promise<unknown> {
    if (!isAutomaticJourneyDevelopment()) return { enabled: false, reason: "DEVELOPMENT_IOS_ONLY" };
    try {
        const native = nativeAutomaticJourney();
        if (typeof native?.[method] !== "function") return { enabled: false, reason: "NATIVE_REBUILD_REQUIRED" };
        return await (native[method] as (...args: string[]) => Promise<unknown>)(...args);
    } catch { return { enabled: false, reason: "AUTOMATIC_ENGINE_UNAVAILABLE" }; }
}
export const getAutomaticJourneySnapshot = async () => normalizeAutomaticJourneySnapshot(await invoke("getAutomaticJourneySnapshot"));
export async function configureAutomaticJourneyNoticeMode(mode: 'OFF' | 'NOTIFICATIONS' | 'VOICE_AND_NOTIFICATIONS'): Promise<void> {
    if (!['OFF', 'NOTIFICATIONS', 'VOICE_AND_NOTIFICATIONS'].includes(mode)) throw new Error('GUIDANCE_NOTICE_MODE_REJECTED');
    const result = automaticRecord(await invoke('configureAutomaticJourneyNoticeMode', [mode]));
    if (result?.accepted !== true) throw new Error('GUIDANCE_NOTICE_MODE_UNAVAILABLE');
}
/** Empty token probes ActivityKit token issuance only. No token is ever included in snapshots. */
export async function configureAutomaticJourneyPushPilot(fcmToken = ""): Promise<void> {
    const result = automaticRecord(await invoke("configureAutomaticJourneyPushPilot", [fcmToken]));
    if (result?.accepted !== true) throw new Error("AUTOMATIC_APNS_PILOT_UNAVAILABLE");
}
/** Null means debug transport opt-in is absent; enabled failures must never fall back to fetch. */
export async function refreshAutomaticJourneyCredentials(apiOrigin: string, refreshToken: string): Promise<unknown | null> {
    if (!isAutomaticJourneyDevelopment()) return null;
    const native = nativeAutomaticJourney();
    if (typeof native?.refreshAutomaticJourneyCredentials !== "function") return null;
    const result = automaticRecord(await native.refreshAutomaticJourneyCredentials(apiOrigin, refreshToken));
    if (result?.available === false) return null;
    if (result?.accepted !== true || typeof result.responseJSON !== "string" || result.responseJSON.length > 65536) {
        throw new Error(result?.errorCode === "AUTOMATIC_SERVER_REJECTED" ? "AUTOMATIC_SERVER_REJECTED" : "AUTOMATIC_SERVER_UNAVAILABLE");
    }
    try {
        const envelope = automaticRecord(JSON.parse(result.responseJSON));
        if (!envelope || typeof envelope.success !== "boolean") throw new Error();
        return envelope;
    } catch { throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE"); }
}
export async function configureAutomaticJourneyAuthentication(auth: JourneyAuthentication): Promise<void> {
    const result = automaticRecord(await invoke("configureAutomaticJourneyAuthentication", [JSON.stringify(auth)]));
    if (result?.accepted !== true) throw new Error("AUTOMATIC_NATIVE_AUTH_REJECTED");
}
export async function updateAutomaticJourneyAuthentication(auth: JourneyAuthentication, binding: AutomaticJourneyBinding, previousAccessToken: string): Promise<void> {
    const result = automaticRecord(await invoke("updateAutomaticJourneyAuthentication", [JSON.stringify(auth), JSON.stringify(binding), previousAccessToken]));
    if (result?.accepted !== true) throw new Error("AUTOMATIC_NATIVE_AUTH_REJECTED");
}
export async function authenticatedAutomaticJourneyRequest(auth: JourneyAuthentication, path: string, body: Record<string, unknown>): Promise<unknown> {
    const result = automaticRecord(await invoke("postAuthenticatedAutomaticJourney", [JSON.stringify(auth), path, JSON.stringify(body)]));
    if (result?.accepted !== true || typeof result.responseJSON !== "string" || result.responseJSON.length > 65536) {
        throw new Error(result?.errorCode === "AUTOMATIC_SERVER_REJECTED" ? "AUTOMATIC_SERVER_REJECTED" : "AUTOMATIC_SERVER_UNAVAILABLE");
    }
    try { return JSON.parse(result.responseJSON) as unknown; } catch { throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE"); }
}
export const stopAutomaticJourney = async () => normalizeAutomaticJourneySnapshot(await invoke("stopAutomaticJourney"));
export async function reconcileAutomaticJourneyTerminal(binding: AutomaticJourneyBinding): Promise<void> {
    const result = automaticRecord(await invoke("reconcileAutomaticJourneyTerminal", [JSON.stringify(binding)]));
    if (result?.accepted !== true) throw new Error("CHECKPOINT_TERMINAL_CLEANUP_REJECTED");
}
export const armAutomaticJourney = async (routeJSON: string, binding: AutomaticJourneyBinding) =>
    normalizeAutomaticJourneySnapshot(await invoke("armAutomaticJourney", [routeJSON, JSON.stringify(binding)]));
export const restoreAutomaticJourney = async (routeJSON: string, binding: AutomaticJourneyBinding) =>
    normalizeAutomaticJourneySnapshot(await invoke("restoreAutomaticJourney", [routeJSON, JSON.stringify(binding)]));
export const acknowledgeAutomaticJourneyDeparture = async (eventKey: string, binding: AutomaticJourneyBinding) =>
    normalizeAutomaticJourneySnapshot(await invoke("acknowledgeAutomaticJourneyDeparture", [eventKey, JSON.stringify(binding)]));
export async function getAutomaticJourneyDeparture(binding: AutomaticJourneyBinding): Promise<AutomaticJourneyDeparture | null> {
    const response = automaticRecord(await invoke("getAutomaticJourneyDeparture"));
    if (response?.available !== true) throw new Error("DEPARTURE_OUTBOX_UNAVAILABLE");
    if (response.eventJSON === null) return null;
    if (typeof response.eventJSON !== "string" || response.eventJSON.length > 4096) throw new Error("INVALID_DEPARTURE_RECEIPT");
    let event: AutomaticJourneyDeparture | null;
    try { event = normalizeAutomaticJourneyDeparture(JSON.parse(response.eventJSON), binding); }
    catch { throw new Error("INVALID_DEPARTURE_RECEIPT"); }
    if (!event) throw new Error("INVALID_DEPARTURE_RECEIPT");
    return event;
}
export function subscribeAutomaticJourney(listener: (snapshot: AutomaticJourneySnapshot) => void): () => void {
    if (!isAutomaticJourneyDevelopment()) return () => undefined;
    let active = true;
    let subscription: { remove(): void } | undefined;
    try {
        subscription = nativeAutomaticJourney()?.addListener("onAutomaticJourneyStateChange", value => {
            if (active) listener(normalizeAutomaticJourneySnapshot(value));
        });
    } catch { /* Missing capability is reported by snapshot(). */ }
    return () => {
        if (!active) return;
        active = false;
        try { subscription?.remove(); } catch { /* Must never stop location on screen unmount. */ }
    };
}

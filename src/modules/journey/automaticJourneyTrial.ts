import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";

import { subscribeAuthInvalidation } from "../auth/authStorage";
import {
    updateAutomaticJourneyAuthentication, configureAutomaticJourneyAuthentication, acknowledgeAutomaticJourneyDeparture, armAutomaticJourney, getAutomaticJourneyDeparture,
    getAutomaticJourneySnapshot, isAutomaticJourneyDevelopment, normalizeAutomaticJourneyBinding, replaceAutomaticJourney,
    beginAutomaticJourneyRerouteCommit, endAutomaticJourneyRerouteCommit,
    restoreAutomaticJourney, readSavedAutomaticJourneyCheckpointRoute, stopAutomaticJourney, subscribeAutomaticJourney, reconcileAutomaticJourneyTerminal,
    type AutomaticJourneyBinding, type AutomaticJourneySnapshot,
} from "./automaticJourney";
import { journeyJSONRequest } from "./journeyJSONRequest";
import { authenticationMetadata, createAuthenticatedJourneyPost, currentJourneyAuthentication, requireJourneyAuthenticationIdentity, requireJourneyAuthenticationLifetime,
    type JourneyAuthentication, type JourneyAuthenticationSource } from "./automaticJourneyAuthentication";
import { createAutomaticJourneyTransport, type AutomaticJourneyRerouteCandidates,
    type AutomaticJourneyRerouteFix, type AutomaticJourneyRerouteWalkingProof,
    type AutomaticJourneyRerouteTransitProof } from "./automaticJourneyTransport";
import { beyondAdmittedRoute, trustedOffRouteFix } from './journeyRerouteEligibility';
import { assessJourneyRouteInput } from "./journeyRouteAssessment";
import { JOURNEY_ROUTE_INPUT_LIMITS, journeyRouteUTF8Bytes, buildJourneyRouteInput, type JourneyRouteInput } from "./journeyRouteInput";
import { createJourneyStopOutbox } from './journeyStopOutbox';
import { requestWalkingSnapshot, savedWalkingBaseJSON } from './serverWalkingSnapshot';
import { getEnv } from '../../api/env';
import { configurePreparedJourneyRemoteUpdates, updatePreparedJourneyRemoteRegistration } from './journeyRemoteUpdates';
import { subscribeAcceptedPushRoute } from '../notification/acceptedPushRoute';

const BINDING_KEY = "@nolate/automatic-journey-trial-binding-v1";
// Fixed isolated fixture endpoint. Never reads API configuration or attaches user auth tokens.
const SANDBOX_ORIGIN = "http://127.0.0.1:15543";
/** A physical iPhone is never allowed to send a SIMULATOR command to the server. */
export function journeyTrialExecution(scope: AutomaticJourneyBinding['syncScope'], physicalDevice =
    (require('expo-device') as typeof import('expo-device')).isDevice): AutomaticJourneyBinding['execution'] {
    if (!physicalDevice) return 'SIMULATOR';
    if (scope !== 'AUTHENTICATED'
        || (getEnv('EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED') !== 'true'
            && getEnv('EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED') !== 'true')) {
        throw new Error('DEVICE_FIELD_TEST_DISABLED');
    }
    return 'DEVICE';
}
export type AutomaticJourneySyncState = {
    status: "IDLE" | "PENDING" | "SENDING" | "ACKNOWLEDGED" | "RETRY_WAIT" | "BLOCKED";
    paused: boolean; errorCode: string | null;
    pendingStopCount?: number;
    checkpointState?: "NONE" | "CHECKING" | "CURRENT" | "CLEARED" | "WAITING" | "BLOCKED";
    savedCheckpoint?: SavedJourneyCheckpoint;
    rerouteState?: 'IDLE' | 'SEARCHING' | 'CANDIDATES' | 'WALK_VERIFIED' | 'WALK_REJECTED'
        | 'TRANSIT_VERIFIED' | 'TRANSIT_REJECTED' | 'RETRY_WAIT';
    rerouteCandidateCount?: number;
};
export type SavedJourneyCheckpoint = { scheduleId: string; memberId: number; sessionId: string; expiresAt: number };
let syncState: AutomaticJourneySyncState = { status: "IDLE", paused: false, errorCode: null };
const listeners = new Set<(state: AutomaticJourneySyncState) => void>();
let current: AutomaticJourneyBinding | null = null;
let currentRouteJSON: string | null = null;
let sourceSavedRouteJSON: string | null = null;
let currentRerouteMapRoute: Record<string, unknown> | null = null;
let preparingSavedRoute: { scheduleId: string; routeJSON: string } | null = null;
/** In-memory only: the selected input must exactly match the armed route. */
export function getAutomaticJourneyTrialBinding(input: JourneyRouteInput): AutomaticJourneyBinding | null {
    return getAutomaticJourneyTrialInput(input) ? { ...current! } : null;
}
export function getAutomaticJourneyTrialInput(input: JourneyRouteInput, expectedDigest?: string): JourneyRouteInput | null {
    if (!current || !currentRouteJSON || (expectedDigest !== undefined && current.routeInputDigest !== expectedDigest)) {
        return null;
    }
    const armed=JSON.parse(currentRouteJSON) as JourneyRouteInput;
    if (armed.routeRevision !== current.routeRevision) return null;
    const source = sourceSavedRouteJSON ?? currentRouteJSON;
    if(source===JSON.stringify(input))return armed;
    return source && savedWalkingBaseJSON(JSON.parse(source))===savedWalkingBaseJSON(input) ? armed : null;
}
export function getAutomaticJourneyTrialDisplayRoute(input: JourneyRouteInput, scheduleId: string) {
    const admitted = getAutomaticJourneyTrialInput(input);
    if (!admitted || current?.scheduleId !== scheduleId || current?.rerouteValidated !== true
        || !currentRerouteMapRoute || !admitted.origin) return null;
    return { route: currentRerouteMapRoute,
        origin: { name: '현재 위치', lat: admitted.origin.latitude, lng: admitted.origin.longitude } };
}
/** Call only with an authoritative update of this saved schedule, never a viewed participant/selection. */
export async function revalidateAutomaticJourneySavedRoute(scheduleId: string, input: JourneyRouteInput | null): Promise<boolean> {
    if (!isAutomaticJourneyDevelopment()) return false;
    const routeJSON = input ? savedWalkingBaseJSON(input) : null;
    const pending = preparingSavedRoute?.scheduleId === scheduleId ? preparingSavedRoute : null;
    const active = current?.savedRouteValidated && current.scheduleId === scheduleId;
    if (!pending && !active) return false;
    const expected=pending?.routeJSON ?? sourceSavedRouteJSON ?? currentRouteJSON;
    if (routeJSON && expected && routeJSON === savedWalkingBaseJSON(JSON.parse(expected))) return false;
    await stopAutomaticJourneyTrial();
    return true;
}
let generation = 0;
let operationBusy = false;
let inFlight: Promise<void> | null = null;
let disposeLifetime: (() => void) | null = null;
let stopping: Promise<AutomaticJourneySnapshot> | null = null;
let nextAutomaticRetryAt = 0;
let rerouteLookup: Promise<void> | null = null;
// An old-session validation may finish after the server has committed its replacement.
// Fence that response until the commit receipt has either installed the new binding or failed.
let rerouteCommitInFlight: AutomaticJourneyBinding | null = null;
type PendingRerouteCommit = {
    binding: AutomaticJourneyBinding; proof: AutomaticJourneyRerouteTransitProof;
    routeJSON: string; digest: string; snapshot: Record<string, unknown>;
    routeRevision: number; expectedGeneration: number;
};
let pendingRerouteCommit: PendingRerouteCommit | null = null;
let rerouteRecoveryFlight: Promise<void> | null = null;
let nextRerouteLookupAt = 0;
let rerouteCandidates: { sessionId: string; generation: number; fix: AutomaticJourneyRerouteFix;
    result: AutomaticJourneyRerouteCandidates; receivedAt: number;
    walkingProof?: AutomaticJourneyRerouteWalkingProof;
    transitProof?: AutomaticJourneyRerouteTransitProof } | null = null;

/** Ephemeral candidates; only the later server commit may turn one into guidance. */
export function getAutomaticJourneyRerouteCandidates() {
    return rerouteCandidates && current?.sessionId === rerouteCandidates.sessionId
        && current.generation === rerouteCandidates.generation
        && Date.now() - rerouteCandidates.receivedAt < 120_000
        ? { ...rerouteCandidates,
            walkingProof: rerouteCandidates.walkingProof
                && rerouteCandidates.walkingProof.validUntilEpochSeconds > Date.now() / 1000
                ? rerouteCandidates.walkingProof : undefined,
            transitProof: rerouteCandidates.transitProof
                && rerouteCandidates.transitProof.validUntilEpochSeconds > Date.now() / 1000
                ? rerouteCandidates.transitProof : undefined } : null;
}

const codeFor = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.message)
    ? error.message : "AUTOMATIC_SYNC_UNAVAILABLE";
function publish(change: Partial<AutomaticJourneySyncState>) {
    syncState = { ...syncState, ...change };
    if (change.checkpointState && change.checkpointState !== 'CURRENT') delete syncState.savedCheckpoint;
    for (const listener of listeners) { try { listener({ ...syncState }); } catch { /* One view must not break the session. */ } }
}
export const getAutomaticJourneySyncState = () => ({ ...syncState });
export function subscribeAutomaticJourneySync(listener: (state: AutomaticJourneySyncState) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
const transport = createAutomaticJourneyTransport(async (path, body) => {
    if (!isAutomaticJourneyDevelopment()) throw new Error("DEVELOPMENT_IOS_ONLY");
    return journeyJSONRequest(`${SANDBOX_ORIGIN}${path}`, body);
});
let authenticationSource: JourneyAuthenticationSource | null = null;
let nativeAuthentication: JourneyAuthentication | null = null;
function transportFor(binding: AutomaticJourneyBinding, source = authenticationSource) {
    if (binding.syncScope !== "AUTHENTICATED") return transport;
    if (!source || !binding.apiOrigin || !binding.authMemberId || binding.loginGeneration == null) throw new Error("AUTOMATIC_AUTH_REQUIRED");
    const identity = { apiOrigin: binding.apiOrigin, authMemberId: binding.authMemberId, loginGeneration: binding.loginGeneration };
    return createAutomaticJourneyTransport(createAuthenticatedJourneyPost(source, identity), identity);
}
async function stopTransportFor(binding: AutomaticJourneyBinding, source: JourneyAuthenticationSource) {
    if (binding.syncScope !== 'AUTHENTICATED') return transport;
    if (!binding.apiOrigin || !binding.authMemberId || binding.loginGeneration == null) throw new Error('AUTOMATIC_AUTH_REQUIRED');
    const auth = await source();
    requireJourneyAuthenticationIdentity(auth, auth);
    if (auth.apiOrigin !== binding.apiOrigin || auth.authMemberId !== binding.authMemberId
        || auth.loginGeneration < binding.loginGeneration) throw new Error('AUTOMATIC_AUTH_CHANGED');
    const identity = { apiOrigin: auth.apiOrigin, authMemberId: auth.authMemberId, loginGeneration: auth.loginGeneration };
    return createAutomaticJourneyTransport(createAuthenticatedJourneyPost(source, identity), identity);
}

const stopOutbox = createJourneyStopOutbox(AsyncStorage);
let reconciliation: Promise<void> | null = null;
/** Cold/foreground cleanup only. Never arms/restores or grants location consent. */
export async function reconcileAutomaticJourneyCheckpoint(source?: JourneyAuthenticationSource): Promise<void> {
    if (!isAutomaticJourneyDevelopment()) return;
    if (reconciliation) return reconciliation;
    if (operationBusy || stopping || current) return;
    operationBusy = true;
    const revision = generation;
    observeLifetime(); // Logout/stop cancels late state-only receipts as well.
    reconciliation = (async () => {
        try {
            const existing = await getAutomaticJourneySnapshot();
            if (!existing.enabled || ['ARMED', 'ACTIVE'].includes(existing.status) || current) return;
            const raw = await AsyncStorage.getItem(BINDING_KEY);
            if (revision !== generation) return;
            if (!raw) {
                publish({ checkpointState: existing.checkpointAvailable ? 'BLOCKED' : 'NONE',
                    ...(existing.checkpointAvailable ? { errorCode: 'CHECKPOINT_BINDING_UNAVAILABLE' } : {}) });
                return;
            }
            if (raw.length > 4096) throw new Error('CHECKPOINT_BINDING_UNAVAILABLE');
            let binding: AutomaticJourneyBinding | null;
            try { binding = normalizeAutomaticJourneyBinding(JSON.parse(raw)); }
            catch { throw new Error('CHECKPOINT_BINDING_UNAVAILABLE'); }
            if (!binding) throw new Error('CHECKPOINT_BINDING_UNAVAILABLE');
            if (binding.syncScope !== 'AUTHENTICATED') return; // No new anonymous/server authority inferred.
            // Native terminal cleanup can finish before JS durably enqueues a stop (process
            // death/background suspension). An absent native checkpoint cannot resume GPS.
            // Preserve this exact owned binding as a durable stop intent, rather than calling
            // the server's still-ACTIVE response proof that native navigation can resume.
            if (existing.status === 'IDLE' && !existing.checkpointAvailable) {
                const selectedSource = source ?? currentJourneyAuthentication;
                const fresh = await selectedSource();
                requireJourneyAuthenticationIdentity(fresh, binding as Required<AutomaticJourneyBinding>);
                if (revision !== generation || current) return;
                if (await AsyncStorage.getItem(BINDING_KEY) !== raw) throw new Error('CHECKPOINT_BINDING_CHANGED');
                await stopOutbox.enqueue(binding);
                if (revision !== generation || current) return;
                if (await AsyncStorage.getItem(BINDING_KEY) !== raw) throw new Error('CHECKPOINT_BINDING_CHANGED');
                await AsyncStorage.removeItem(BINDING_KEY);
                await retryAutomaticJourneyStops(selectedSource);
                if (revision === generation && !current) publish({ checkpointState: stopOutbox.summary().pendingCount ? 'WAITING' : 'CLEARED' });
                return;
            }
            await retryAutomaticJourneyStops(source);
            if (revision !== generation || current) return;
            if (stopOutbox.summary().pendingCount || stopOutbox.summary().errorCode) throw new Error('CHECKPOINT_STOP_PENDING');
            publish({ checkpointState: 'CHECKING', errorCode: null });
            const selectedSource = source ?? currentJourneyAuthentication;
            const server = await transportFor(binding, selectedSource).current(binding);
            if (server?.state === 'ACTIVE' && server.rerouteValidated === true
                && server.generation === binding.generation + 1
                && server.routeRevision === binding.routeRevision + 1 && existing.checkpointAvailable) {
                if (revision !== generation || current) return;
                publish({ checkpointState: 'CURRENT', errorCode: null,
                    savedCheckpoint: binding.savedRouteValidated && binding.authMemberId && {
                        scheduleId: binding.scheduleId, memberId: binding.authMemberId,
                        sessionId: binding.sessionId, expiresAt: binding.expiresAtEpochSeconds,
                    } || undefined });
                return;
            }
            const result = await transportFor(binding, selectedSource).reconcile(binding);
            if (revision !== generation || current) return;
            if (await AsyncStorage.getItem(BINDING_KEY) !== raw) throw new Error('CHECKPOINT_BINDING_CHANGED');
            if (result === 'CURRENT') {
                publish({ checkpointState: 'CURRENT', errorCode: null,
                    savedCheckpoint: binding.savedRouteValidated && binding.authMemberId && {
                        scheduleId: binding.scheduleId, memberId: binding.authMemberId,
                        sessionId: binding.sessionId, expiresAt: binding.expiresAtEpochSeconds,
                    } || undefined });
                return; // Preserve the checkpoint; resuming location still requires existing explicit consent/validation.
            }
            const fresh = await selectedSource();
            requireJourneyAuthenticationIdentity(fresh, binding as Required<AutomaticJourneyBinding>);
            if (revision !== generation || current) return;
            await reconcileAutomaticJourneyTerminal(binding);
            if (revision !== generation || current) return;
            // Native compare-and-revoke protects another checkpoint. Never delete changed JS metadata.
            if (await AsyncStorage.getItem(BINDING_KEY) !== raw) throw new Error('CHECKPOINT_BINDING_CHANGED');
            await AsyncStorage.removeItem(BINDING_KEY);
            if (revision === generation) publish({ checkpointState: 'CLEARED', status: 'IDLE', errorCode: null });
        } catch (error) {
            if (revision !== generation) return;
            const code = codeFor(error);
            const blocked = ['AUTOMATIC_AUTH_REQUIRED', 'AUTOMATIC_AUTH_CHANGED', 'AUTOMATIC_SERVER_REJECTED',
                'INVALID_AUTOMATIC_RECONCILIATION', 'INVALID_AUTOMATIC_SERVER_RESPONSE', 'CHECKPOINT_BINDING_UNAVAILABLE', 'CHECKPOINT_BINDING_CHANGED',
                'CHECKPOINT_TERMINAL_CLEANUP_REJECTED'].includes(code);
            publish({ checkpointState: blocked ? 'BLOCKED' : 'WAITING', errorCode: code });
            // No 401/404/malformed payload is treated as proof that this owned session ended.
        } finally {
            operationBusy = false;
            if (!current) disposeLifetime?.();
        }
    })();
    try { await reconciliation; } finally { reconciliation = null; }
}

export async function retryAutomaticJourneyStops(source?: JourneyAuthenticationSource): Promise<void> {
    if (!isAutomaticJourneyDevelopment()) return;
    const selected = source ?? authenticationSource ?? currentJourneyAuthentication;
    const result = await stopOutbox.drain(async binding => (await stopTransportFor(binding, selected)).stop(binding));
    publish({ pendingStopCount: result.pendingCount, ...(result.pendingCount || result.errorCode
        ? { status: 'RETRY_WAIT', errorCode: result.errorCode ?? 'STOP_DELIVERY_PENDING' }
        : syncState.pendingStopCount ? { status: 'IDLE', errorCode: null } : {}) });
}

/** This pump outlives a screen. Native owns the persistent event; JS only transports/acknowledges it. */
function observeLifetime() {
    if (disposeLifetime) return;
    const automaticRetry = () => {
        retryAutomaticJourneyStops().catch(() => undefined);
        if (Date.now() >= nextAutomaticRetryAt) retryAutomaticJourneySync().then(updateRemoteRegistration).catch(() => undefined);
    };
    const updateRemoteRegistration = () => {
        if (current && nativeAuthentication) return updatePreparedJourneyRemoteRegistration(nativeAuthentication, current);
        return Promise.resolve();
    };
    const registration = subscribeAcceptedPushRoute(() => { updateRemoteRegistration().catch(() => undefined); });
    const unsub = subscribeAutomaticJourney(snapshot => {
        if (current && snapshot.sessionId === current.sessionId && ['STOPPED', 'EXPIRED'].includes(snapshot.status)) {
            // A native terminal event also owns remote cleanup (including lease expiry and
            // permission revocation), not just an explicit UI stop/auth error.
            stopAutomaticJourneyTrial().catch(() => undefined);
            return;
        }
        if (snapshot.pendingDeparture) automaticRetry();
        searchRerouteAfterConfirmedOffRoute(snapshot);
    });
    const app = AppState.addEventListener("change", state => {
        if (state === "active") {
            automaticRetry();
            getAutomaticJourneySnapshot().then(searchRerouteAfterConfirmedOffRoute).catch(() => undefined);
        }
    });
    const auth = subscribeAuthInvalidation(async () => { await stopAutomaticJourneyTrial(); });
    const timer = setInterval(() => {
        if (AppState.currentState === "active") automaticRetry();
    }, 5000);
    disposeLifetime = () => { unsub(); registration(); app.remove(); auth(); clearInterval(timer); disposeLifetime = null; };
}
function searchRerouteAfterConfirmedOffRoute(snapshot: AutomaticJourneySnapshot) {
    if (getEnv('EXPO_PUBLIC_AUTOMATIC_REROUTE_ENABLED') !== 'true' || AppState.currentState !== 'active') return;
    const binding = current;
    if (!binding || binding.syncScope !== 'AUTHENTICATED' || !binding.savedRouteValidated
        || snapshot.pendingDeparture || !snapshot.departureAcknowledged
        || rerouteCommitInFlight === binding) return;
    const fix = trustedOffRouteFix(snapshot, binding, Date.now() / 1000);
    if (!fix) {
        if (rerouteCandidates) { rerouteCandidates = null; publish({ rerouteState: 'IDLE', rerouteCandidateCount: 0 }); }
        return;
    }
    if (rerouteCandidates) {
        const previous = rerouteCandidates.fix;
        const dy = (fix.latitude - previous.latitude) * 111_195;
        const dx = (fix.longitude - previous.longitude) * 111_195
            * Math.cos((fix.latitude + previous.latitude) * Math.PI / 360);
        if (Date.now() - rerouteCandidates.receivedAt >= 120_000 || Math.hypot(dx, dy) >= 100
            || rerouteCandidates.walkingProof && rerouteCandidates.walkingProof.validUntilEpochSeconds <= Date.now() / 1000
            || rerouteCandidates.transitProof && rerouteCandidates.transitProof.validUntilEpochSeconds <= Date.now() / 1000) {
            rerouteCandidates = null;
            publish({ rerouteState: 'IDLE', rerouteCandidateCount: 0 });
        }
    }
    if (rerouteLookup || Date.now() < nextRerouteLookupAt || rerouteCandidates) return;
    if (currentRouteJSON && !beyondAdmittedRoute(fix, JSON.parse(currentRouteJSON) as JourneyRouteInput)) return;
    nextRerouteLookupAt = Date.now() + 20_000;
    const revision = generation;
    publish({ rerouteState: 'SEARCHING', rerouteCandidateCount: 0 });
    rerouteLookup = (async () => {
        try {
            const result = await transportFor(binding).rerouteCandidates(binding, fix);
            if (revision !== generation || current !== binding) return;
            rerouteCandidates = { sessionId: binding.sessionId, generation: binding.generation,
                fix, result, receivedAt: Date.now() };
            publish({ rerouteState: 'CANDIDATES', rerouteCandidateCount: result.paths.length });
            if (getEnv('EXPO_PUBLIC_AUTOMATIC_REROUTE_WALKING_ENABLED') === 'true') {
                const candidate = result.paths.find(path => {
                    const legs = path.rps;
                    return Array.isArray(legs) && legs.length === 3
                        && legs.map(leg => (leg as { trafficType?: unknown })?.trafficType).join(',') === '3,2,3';
                });
                if (candidate) {
                    try {
                        const proof = await transportFor(binding).rerouteWalkingProof(binding, candidate.candidateId);
                        if (revision !== generation || current !== binding || !rerouteCandidates
                            || rerouteCandidates.result !== result) return;
                        rerouteCandidates.walkingProof = proof;
                        publish({ rerouteState: 'WALK_VERIFIED', rerouteCandidateCount: result.paths.length });
                        if (getEnv('EXPO_PUBLIC_AUTOMATIC_REROUTE_TRANSIT_ENABLED') === 'true') {
                            try {
                                const transitProof = await transportFor(binding).rerouteTransitProof(binding, proof);
                                if (revision !== generation || current !== binding || !rerouteCandidates
                                    || rerouteCandidates.result !== result) return;
                                rerouteCandidates.transitProof = transitProof;
                                publish({ rerouteState: 'TRANSIT_VERIFIED', rerouteCandidateCount: result.paths.length });
                                if (getEnv('EXPO_PUBLIC_AUTOMATIC_REROUTE_COMMIT_ENABLED') === 'true') {
                                    await commitVerifiedReroute(binding, transitProof, fix, revision);
                                }
                            } catch (error) {
                                if (revision !== generation || current !== binding || !rerouteCandidates
                                    || rerouteCandidates.result !== result) return;
                                publish({ rerouteState: 'TRANSIT_REJECTED', rerouteCandidateCount: result.paths.length,
                                    errorCode: codeFor(error) });
                            }
                        }
                    } catch (error) {
                        if (revision !== generation || current !== binding || !rerouteCandidates
                            || rerouteCandidates.result !== result) return;
                        publish({ rerouteState: 'WALK_REJECTED', rerouteCandidateCount: result.paths.length,
                            errorCode: codeFor(error) });
                    }
                }
            }
        } catch {
            if (revision !== generation || current !== binding) return;
            nextRerouteLookupAt = Date.now() + 30_000;
            publish({ rerouteState: 'RETRY_WAIT', rerouteCandidateCount: 0 });
        } finally { rerouteLookup = null; }
    })();
}

function matchingCommittedRerouteReceipt(server: Record<string, unknown> | null,
    pending: PendingRerouteCommit): Record<string, unknown> | null {
    const { binding, proof, routeJSON, digest } = pending;
    if (server?.state !== 'ACTIVE' || server.rerouteValidated !== true
        || server.sessionId === binding.sessionId
        || server.generation !== binding.generation + 1
        || server.routeRevision !== pending.routeRevision
        || server.routeInputDigest !== digest
        || server.routeFingerprint !== proof.routeFingerprint
        || server.rerouteInputJSON !== routeJSON
        || server.rerouteSnapshotJSON !== proof.routeSnapshotJSON
        || !server.rerouteBusAdmission) return null;
    return { ...server, officialBusAdmission: server.rerouteBusAdmission };
}

async function installCommittedReroute(pending: PendingRerouteCommit,
    receipt: Record<string, unknown>): Promise<void> {
    const { binding, routeJSON, digest, snapshot, routeRevision, expectedGeneration } = pending;
    if (expectedGeneration !== generation || current !== binding) return;
    const replacement = normalizeAutomaticJourneyBinding({ ...binding,
        sessionId: receipt.sessionId, generation: receipt.generation,
        routeRevision: receipt.routeRevision, routeInputDigest: receipt.routeInputDigest,
        preparedAtEpochSeconds: Date.parse(receipt.preparedAt as string) / 1000,
        expiresAtEpochSeconds: Date.parse(receipt.expiresAt as string) / 1000,
        rerouteValidated: true, officialBusAdmission: receipt.officialBusAdmission,
        officialSubwayAdmission: undefined, officialBusAdmissions: undefined, officialSubwayAdmissions: undefined,
    });
    if (!replacement || replacement.routeInputDigest !== digest || replacement.routeRevision !== routeRevision) {
        throw new Error('INVALID_AUTOMATIC_SERVER_RESPONSE');
    }
    // Once the server commits, this is the only binding permitted to stop the session.
    current = replacement;
    try {
        if (expectedGeneration !== generation) throw new Error('AUTOMATIC_OPERATION_CANCELLED');
        const native = await replaceAutomaticJourney(routeJSON, replacement);
        if (!native.enabled || native.status !== 'ACTIVE' || native.sessionId !== replacement.sessionId
            || native.routeRevision !== replacement.routeRevision || !native.departureAcknowledged) {
            throw new Error(native.lastErrorCode ?? 'REROUTE_REPLACEMENT_REJECTED');
        }
        if (expectedGeneration !== generation) throw new Error('AUTOMATIC_OPERATION_CANCELLED');
        await AsyncStorage.setItem(BINDING_KEY, JSON.stringify(replacement));
        sourceSavedRouteJSON ??= currentRouteJSON;
        currentRouteJSON = routeJSON;
        currentRerouteMapRoute = snapshot;
        rerouteCandidates = null;
        nextRerouteLookupAt = Date.now() + 20_000;
        ++generation;
        publish({ status: 'ACKNOWLEDGED', errorCode: null, rerouteState: 'IDLE', rerouteCandidateCount: 0 });
    } catch (error) {
        await stopAutomaticJourneyTrial();
        throw error;
    }
}

async function retryPendingRerouteCommit(): Promise<void> {
    if (rerouteRecoveryFlight) return rerouteRecoveryFlight;
    const pending = pendingRerouteCommit;
    if (!pending || current !== pending.binding || generation !== pending.expectedGeneration) return;
    rerouteRecoveryFlight = (async () => {
        let server: Record<string, unknown> | null;
        try { server = await transportFor(pending.binding).current(pending.binding); }
        catch (error) {
            if (pendingRerouteCommit !== pending || current !== pending.binding) return;
            if (['AUTOMATIC_AUTH_REQUIRED', 'AUTOMATIC_AUTH_CHANGED'].includes(codeFor(error))) {
                await stopAutomaticJourneyTrial();
                publish({ status: 'BLOCKED', errorCode: codeFor(error) });
                return;
            }
            nextAutomaticRetryAt = Date.now() + 5000;
            publish({ rerouteState: 'RETRY_WAIT', errorCode: 'REROUTE_COMMIT_UNCERTAIN' });
            return;
        }
        if (pendingRerouteCommit !== pending || current !== pending.binding
            || generation !== pending.expectedGeneration) return;
        const receipt = matchingCommittedRerouteReceipt(server, pending);
        pendingRerouteCommit = null;
        if (receipt) {
            try { await installCommittedReroute(pending, receipt); }
            finally { if (rerouteCommitInFlight === pending.binding) rerouteCommitInFlight = null; }
        } else if (server?.sessionId === pending.binding.sessionId && server.state === 'ACTIVE') {
            rerouteCommitInFlight = null;
            rerouteCandidates = null;
            nextRerouteLookupAt = Date.now() + 20_000;
            try {
                await endAutomaticJourneyRerouteCommit(pending.binding);
                publish({ rerouteState: 'RETRY_WAIT', errorCode: 'REROUTE_COMMIT_NOT_APPLIED' });
            } catch {
                await stopAutomaticJourneyTrial();
                publish({ status: 'BLOCKED', errorCode: 'REROUTE_NATIVE_HOLD_RELEASE_REJECTED' });
            }
        } else {
            // Unknown latest ownership or a terminal server session cannot authorize
            // continuing location guidance on the old route.
            rerouteCommitInFlight = null;
            await stopAutomaticJourneyTrial();
            publish({ status: 'BLOCKED', errorCode: 'REROUTE_COMMIT_UNVERIFIED' });
        }
    })();
    try { await rerouteRecoveryFlight; } finally { rerouteRecoveryFlight = null; }
}

async function commitVerifiedReroute(binding: AutomaticJourneyBinding,
    proof: AutomaticJourneyRerouteTransitProof, fix: AutomaticJourneyRerouteFix,
    expectedGeneration: number): Promise<void> {
    if (expectedGeneration !== generation || current !== binding || !currentRouteJSON) return;
    if (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, proof.routeSnapshotJSON)
        !== proof.routeFingerprint) throw new Error('INVALID_REROUTE_SNAPSHOT');
    const snapshot = JSON.parse(proof.routeSnapshotJSON) as Record<string, unknown>;
    const source = JSON.parse(sourceSavedRouteJSON ?? currentRouteJSON) as JourneyRouteInput;
    if (!source.destination) throw new Error('REROUTE_DESTINATION_UNAVAILABLE');
    const route = buildJourneyRouteInput(snapshot, {
        routeRevision: binding.routeRevision + 1, context: 'SAVED_ROUTE',
        origin: { lat: fix.latitude, lng: fix.longitude },
        destination: { lat: source.destination.latitude, lng: source.destination.longitude },
    });
    if (!route.ok) throw new Error(route.reason);
    const routeJSON = JSON.stringify(route.input);
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, routeJSON);
    if (expectedGeneration !== generation || current !== binding) return;
    const pending: PendingRerouteCommit = { binding, proof, routeJSON, digest, snapshot,
        routeRevision: route.input.routeRevision, expectedGeneration };
    rerouteCommitInFlight = binding;
    let nativeHeld = false;
    try {
        await beginAutomaticJourneyRerouteCommit(binding);
        nativeHeld = true;
        if (expectedGeneration !== generation || current !== binding) return;
        let receipt: Record<string, unknown>;
        try { receipt = await transportFor(binding).commitReroute(binding, proof, routeJSON); }
        catch (error) {
            let server: Record<string, unknown> | null;
            try { server = await transportFor(binding).current(binding); }
            catch (lookupError) {
                if (expectedGeneration !== generation || current !== binding) return;
                if (['AUTOMATIC_AUTH_REQUIRED', 'AUTOMATIC_AUTH_CHANGED'].includes(codeFor(lookupError))) throw lookupError;
                // Keep the old 409 fenced until an authoritative /current result arrives.
                pendingRerouteCommit = pending;
                nextAutomaticRetryAt = Date.now() + 5000;
                publish({ rerouteState: 'RETRY_WAIT', errorCode: 'REROUTE_COMMIT_UNCERTAIN' });
                return;
            }
            const recovered = matchingCommittedRerouteReceipt(server, pending);
            if (!recovered) throw error;
            receipt = recovered;
        }
        await installCommittedReroute(pending, receipt);
    } finally {
        if (pendingRerouteCommit !== pending && rerouteCommitInFlight === binding) {
            rerouteCommitInFlight = null;
            if (current === binding && nativeHeld) {
                try { await endAutomaticJourneyRerouteCommit(binding); }
                catch { await stopAutomaticJourneyTrial(); }
            }
        }
    }
}
export function setAutomaticJourneySyncPaused(paused: boolean) {
    publish({ paused });
    if (!paused) retryAutomaticJourneySync().catch(() => undefined);
}
export async function retryAutomaticJourneySync(): Promise<void> {
    if (!isAutomaticJourneyDevelopment() || !current || syncState.status === "BLOCKED") return;
    if (pendingRerouteCommit) return retryPendingRerouteCommit();
    if (inFlight) return inFlight;
    const binding = current;
    if (rerouteCommitInFlight === binding) return;
    const revision = generation;
    inFlight = (async () => {
        try {
            // Account fencing must also run AFTER the outbox is acknowledged and empty.
            // Otherwise an account switch could leave the old native credential snapshot alive.
            if (binding.syncScope === "AUTHENTICATED") {
                if (!authenticationSource) throw new Error("AUTOMATIC_AUTH_REQUIRED");
                const fresh = await authenticationSource();
                requireJourneyAuthenticationIdentity(fresh, binding as Required<AutomaticJourneyBinding>);
                if (revision !== generation || current !== binding) return;
                if (!nativeAuthentication) throw new Error("AUTOMATIC_AUTH_REQUIRED");
                if (fresh.accessToken !== nativeAuthentication.accessToken) {
                    await updateAutomaticJourneyAuthentication(fresh, binding, nativeAuthentication.accessToken);
                    if (revision !== generation || current !== binding) return;
                    nativeAuthentication = fresh;
                }
            }
            if (revision !== generation) return;
            const selected=currentRouteJSON ? JSON.parse(currentRouteJSON) as JourneyRouteInput : null;
            if(binding.syncScope==='AUTHENTICATED'&&selected?.walkingSnapshot&&authenticationSource){
                const previous=selected.walkingSnapshot;
                try {
                    if(previous.schemaVersion===3 || previous.schemaVersion===4) {
                        // The planning endpoint deliberately rejects new admission after 300s.
                        // An already-owned preparation uses the server's persisted admission time;
                        // validate still checks cancellation/replacement/current route and login.
                        // Never issue another snapshot or extend either lifetime on resume.
                        await transportFor(binding).validate(binding);
                    } else {
                        const latest=await requestWalkingSnapshot(authenticationSource,previous,'current');
                        if(latest?.snapshotId!==previous.snapshotId)throw new Error('SNAPSHOT_REPLACED');
                    }
                } catch(error) {
                    if(['SNAPSHOT_REPLACED','SNAPSHOT_NOT_FOUND','REVISION_CHANGED','SAVED_ROUTE_CHANGED','EXPIRED','OWNER_CHANGED',
                        'INVALID_WALKING_SNAPSHOT'].includes(codeFor(error)))throw new Error('AUTOMATIC_SERVER_REJECTED');
                    if (codeFor(error) === 'AUTOMATIC_SERVER_UNAVAILABLE') throw new Error('SAVED_ROUTE_VALIDATION_UNAVAILABLE');
                    throw error;
                }
                if(revision!==generation||current!==binding)return;
            }
            const event = await getAutomaticJourneyDeparture(binding);
            if (revision !== generation || current !== binding) return;
            if (!event) {
                // A successful validation can recover even after departure was acknowledged.
                // Retire only its own retry, leaving stop and reroute work to their handlers.
                const recovery = syncState;
                if (binding.syncScope === 'AUTHENTICATED' && selected?.walkingSnapshot && recovery.status === 'RETRY_WAIT'
                    && recovery.errorCode === 'SAVED_ROUTE_VALIDATION_UNAVAILABLE' && !recovery.pendingStopCount
                    && (!recovery.rerouteState || recovery.rerouteState === 'IDLE')) {
                    const confirmed = await getAutomaticJourneySnapshot();
                    if (revision === generation && current === binding && syncState === recovery
                        && confirmed.sessionId === binding.sessionId && confirmed.routeRevision === binding.routeRevision
                        && ['ARMED', 'ACTIVE'].includes(confirmed.status) && !confirmed.pendingDeparture) {
                        publish({status: confirmed.departureAcknowledged ? 'ACKNOWLEDGED' : 'IDLE', errorCode: null});
                    }
                }
                return;
            }
            if (binding.syncScope === "LOCAL_ONLY" || syncState.paused) { publish({ status: "PENDING", errorCode: null }); return; }
            publish({ status: "SENDING", errorCode: null });
            await transportFor(binding).depart(event);
            // A stop, logout, or another binding invalidates even a successful late HTTP reply.
            if (revision !== generation || current !== binding) return;
            const snapshot = await acknowledgeAutomaticJourneyDeparture(event.eventKey, binding);
            if (revision !== generation) return;
            if (snapshot.sessionId !== binding.sessionId || !snapshot.departureAcknowledged || snapshot.pendingDeparture) {
                throw new Error("NATIVE_ACK_NOT_PERSISTED");
            }
            publish({ status: "ACKNOWLEDGED", errorCode: null });
        } catch (error) {
            // A committed reroute replaces the binding before the old validation
            // response can arrive. Its expected 409 must never stop the new session.
            if (revision !== generation || current !== binding || rerouteCommitInFlight === binding) return;
            const code = codeFor(error);
            if (binding.syncScope === "AUTHENTICATED" && ["AUTOMATIC_AUTH_REQUIRED", "AUTOMATIC_AUTH_CHANGED", "AUTOMATIC_SERVER_REJECTED", "AUTOMATIC_NATIVE_AUTH_REJECTED"].includes(code)) {
                await stopAutomaticJourneyTrial();
                publish({ status: "BLOCKED", errorCode: code });
                return;
            }
            const terminal = ["AUTOMATIC_SERVER_REJECTED", "INVALID_AUTOMATIC_SERVER_RESPONSE", "INVALID_DEPARTURE_RECEIPT"].includes(code);
            nextAutomaticRetryAt = Date.now() + 5000;
            publish({ status: terminal ? "BLOCKED" : "RETRY_WAIT", errorCode: code });
        }
    })();
    try { await inFlight; } finally { inFlight = null; }
}

async function selectedInput(input: JourneyRouteInput, scope: AutomaticJourneyBinding["syncScope"], saved = false) {
    if (!isAutomaticJourneyDevelopment()) throw new Error("DEVELOPMENT_IOS_ONLY");
    const routeJSON = JSON.stringify(input);
    if (journeyRouteUTF8Bytes(routeJSON) > JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes) throw new Error("INPUT_LIMIT_EXCEEDED");
    const copied = JSON.parse(routeJSON) as JourneyRouteInput;
    const assessment = await assessJourneyRouteInput(copied);
    if (!assessment.available) throw new Error(assessment.reason);
    const { summary } = assessment;
    const first = summary.legs[0];
    const syntheticCandidate = copied.context === "SYNTHETIC_FIXTURE" && scope === "SANDBOX"
        && summary.reasonCodes.length === 1 && summary.reasonCodes[0] === "SYNTHETIC_FIXTURE_ONLY"
        && first?.kind === "WALK" && first.geometryUsable && first.geometryLengthMeters !== null
        && first.geometryLengthMeters >= 70 && first.geometryLengthMeters <= 100_000;
    const savedReasons = summary.reasonCodes.length === 1 && summary.reasonCodes[0] === 'SAVED_ROUTE_REVALIDATION_REQUIRED'
        || copied.provider === 'odsay' && copied.serviceState === 'UNKNOWN' && summary.reasonCodes.length === 2
            && summary.reasonCodes.includes('SAVED_ROUTE_REVALIDATION_REQUIRED') && summary.reasonCodes.includes('ROUTE_SERVICE_UNVERIFIED');
    const savedCandidate = saved && copied.context === "SAVED_ROUTE" && scope !== "LOCAL_ONLY" && savedReasons
        && first?.kind === "WALK" && first.geometryUsable;
    if (!(copied.context === "ROUTING_RESPONSE" && summary.eligibleDepartureLegIndex === 0) && !syntheticCandidate && !savedCandidate) {
        throw new Error("ROUTE_NOT_ELIGIBLE");
    }
    return { routeJSON, input: copied, digest: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, routeJSON) };
}

export async function prepareAutomaticJourneyTrial(input: JourneyRouteInput, scope: AutomaticJourneyBinding["syncScope"], savedScheduleId?: string,
    authSource?: JourneyAuthenticationSource, departureSignal?: AbortSignal): Promise<AutomaticJourneySnapshot> {
    if (!isAutomaticJourneyDevelopment()) throw new Error("DEVELOPMENT_IOS_ONLY");
    if (stopping || (operationBusy && !(departureSignal && reconciliation))) throw new Error("AUTOMATIC_OPERATION_PENDING");
    if (!["LOCAL_ONLY", "SANDBOX", "AUTHENTICATED"].includes(scope)) throw new Error("INVALID_SYNC_SCOPE");
    let revision = generation;
    await retryAutomaticJourneyStops(authSource);
    // Returning from the system location prompt can start a foreground checkpoint
    // check during this same tap. Finish that check before admitting a new session.
    if (departureSignal && reconciliation) await reconciliation;
    if (departureSignal?.aborted || revision !== generation) throw new Error('AUTOMATIC_OPERATION_CANCELLED');
    if (stopOutbox.summary().pendingCount || stopOutbox.summary().errorCode) throw new Error('PENDING_STOP_BLOCKS_PREPARE');
    if (operationBusy || stopping) throw new Error('AUTOMATIC_OPERATION_PENDING');
    operationBusy = true;
    let binding: AutomaticJourneyBinding | null = null;
    let armRequested = false;
    observeLifetime(); // Also fences logout while preparation is still in flight and the view closes.
    try {
        preparingSavedRoute = savedScheduleId ? { scheduleId: savedScheduleId, routeJSON: JSON.stringify(input) } : null;
        const existing = await getAutomaticJourneySnapshot();
        if (!existing.enabled) throw new Error(existing.reason ?? "AUTOMATIC_ENGINE_UNAVAILABLE");
        if (existing.status === "ARMED" || existing.status === "ACTIVE" || existing.pendingDeparture) throw new Error("SESSION_ALREADY_RUNNING");
        // A restarted process has not loaded the saved outbox yet. Never use a failed new arm
        // and its fail-closed cleanup to implicitly revoke a recoverable prior session.
        if (existing.checkpointAvailable || await AsyncStorage.getItem(BINDING_KEY)) throw new Error("CHECKPOINT_RESTORE_OR_STOP_REQUIRED");
        if (departureSignal?.aborted || revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        revision = ++generation;
        if (savedScheduleId && (scope === "LOCAL_ONLY" || !/^[1-9]\d{0,17}$/.test(savedScheduleId))) throw new Error("INVALID_SAVED_SCOPE");
        const selected = await selectedInput(input, scope, !!savedScheduleId);
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        const now = Date.now() / 1000;
        const requestId = Crypto.randomUUID().toLowerCase();
        const clientOwnerId = Crypto.randomUUID().toLowerCase();
        const auth = scope === "AUTHENTICATED" ? await (authSource ?? currentJourneyAuthentication)() : null;
        if (scope === "AUTHENTICATED" && !savedScheduleId) throw new Error("INVALID_SAVED_SCOPE");
        authenticationSource = auth ? (authSource ?? currentJourneyAuthentication) : null;
        const selectedTransport = auth ? createAutomaticJourneyTransport(
            createAuthenticatedJourneyPost(authenticationSource!, auth), authenticationMetadata(auth)) : transport;
        const execution = journeyTrialExecution(scope);
        binding = scope !== "LOCAL_ONLY" ? await selectedTransport.prepare(savedScheduleId ?? "9001", {
            requestId, clientOwnerId, routeInputDigest: selected.digest, execution,
            ...(savedScheduleId ? { routeInputJSON: selected.routeJSON } : {}),
        }) : {
            sessionId: requestId, scheduleId: "9001", generation: 1, routeRevision: selected.input.routeRevision,
            clientOwnerId, routeInputDigest: selected.digest, preparedAtEpochSeconds: now, expiresAtEpochSeconds: now + 600,
            execution, syncScope: scope,
        };
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        if (binding.routeRevision !== selected.input.routeRevision) throw new Error("ROUTE_REVISION_MISMATCH");
        if (binding.savedRouteValidated) await selectedTransport.validate(binding);
        if (auth) {
            const extended = binding.expiresAtEpochSeconds - binding.preparedAtEpochSeconds > 600.001;
            const latest = await authenticationSource!(extended ? binding.expiresAtEpochSeconds : undefined);
            requireJourneyAuthenticationIdentity(latest, auth);
            if (extended) requireJourneyAuthenticationLifetime(latest, binding.expiresAtEpochSeconds);
            if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
            await configureAutomaticJourneyAuthentication(latest);
            nativeAuthentication = latest;
            await configurePreparedJourneyRemoteUpdates(latest, binding);
        }
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        // Only identity/digest/expiry persist in JS, never route coordinates or auth material.
        await AsyncStorage.setItem(BINDING_KEY, JSON.stringify(binding));
        if (departureSignal?.aborted || revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        armRequested = true;
        const snapshot = await armAutomaticJourney(selected.routeJSON, binding);
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        if (!snapshot.enabled || snapshot.status !== "ARMED" || snapshot.sessionId !== binding.sessionId) {
            throw new Error(snapshot.lastErrorCode ?? snapshot.reason ?? "AUTOMATIC_PREPARATION_FAILED");
        }
        current = binding;
        rerouteCandidates = null;
        nextRerouteLookupAt = 0;
        currentRouteJSON = selected.routeJSON;
        sourceSavedRouteJSON = selected.routeJSON;
        currentRerouteMapRoute = null;
        nextAutomaticRetryAt = 0;
        publish({ status: "IDLE", errorCode: null, checkpointState: 'NONE',
            rerouteState: 'IDLE', rerouteCandidateCount: 0 });
        observeLifetime();
        return snapshot;
    } catch (error) {
        if (armRequested) await stopAutomaticJourney();
        let cleanupPersisted = true;
        if (binding && binding.syncScope !== "LOCAL_ONLY") {
            try { await stopOutbox.enqueue(binding); await retryAutomaticJourneyStops(); }
            catch { cleanupPersisted = false; }
        }
        if (!current) { authenticationSource = null; nativeAuthentication = null; }
        if (binding && cleanupPersisted) await AsyncStorage.removeItem(BINDING_KEY).catch(() => undefined);
        if (!current && revision === generation) publish({ status: "BLOCKED", errorCode: codeFor(error) });
        if (!current) disposeLifetime?.();
        throw new Error(codeFor(error));
    } finally { operationBusy = false; preparingSavedRoute = null; }
}

export async function restoreAutomaticJourneyTrial(input: JourneyRouteInput, authSource?: JourneyAuthenticationSource,
    savedCheckpoint?: SavedJourneyCheckpoint): Promise<AutomaticJourneySnapshot> {
    if (!isAutomaticJourneyDevelopment()) throw new Error("DEVELOPMENT_IOS_ONLY");
    if (operationBusy || stopping) throw new Error("AUTOMATIC_OPERATION_PENDING");
    await retryAutomaticJourneyStops(authSource);
    if (stopOutbox.summary().pendingCount || stopOutbox.summary().errorCode) throw new Error('PENDING_STOP_BLOCKS_RESTORE');
    if (operationBusy || stopping) throw new Error('AUTOMATIC_OPERATION_PENDING');
    operationBusy = true;
    let revision = generation;
    let restoreRequested = false;
    observeLifetime();
    try {
        const existing = await getAutomaticJourneySnapshot();
        if (existing.status === "ARMED" || existing.status === "ACTIVE") throw new Error("SESSION_ALREADY_RUNNING");
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        revision = ++generation;
        const raw = await AsyncStorage.getItem(BINDING_KEY);
        if (!raw || raw.length > 4096) throw new Error("TRIAL_BINDING_UNAVAILABLE");
        let binding = normalizeAutomaticJourneyBinding(JSON.parse(raw));
        if (!binding) throw new Error("TRIAL_BINDING_UNAVAILABLE");
        if (binding.execution !== journeyTrialExecution(binding.syncScope)) throw new Error('TRIAL_EXECUTION_MISMATCH');
        if (savedCheckpoint && (binding.syncScope !== "AUTHENTICATED" || !binding.savedRouteValidated ||
            binding.scheduleId !== savedCheckpoint.scheduleId || binding.sessionId !== savedCheckpoint.sessionId ||
            binding.authMemberId !== savedCheckpoint.memberId || binding.expiresAtEpochSeconds !== savedCheckpoint.expiresAt ||
            input.context !== "SAVED_ROUTE")) throw new Error("ROUTE_BINDING_MISMATCH");
        let routeJSON: string | undefined;
        if (!savedCheckpoint) {
            if (binding.rerouteValidated) {
                if (input.context !== 'SAVED_ROUTE') throw new Error('ROUTE_BINDING_MISMATCH');
            } else {
                const selected = await selectedInput(input, binding.syncScope, binding.savedRouteValidated === true);
                if (selected.digest !== binding.routeInputDigest) throw new Error("ROUTE_BINDING_MISMATCH");
                routeJSON = selected.routeJSON;
            }
        }
        const restoreAuthentication = authSource ?? currentJourneyAuthentication;
        if (binding.syncScope === "AUTHENTICATED") authenticationSource = restoreAuthentication;
        // A server commit can win the race against a process death. Reconcile that one
        // authoritative revision before validating or restoring the old checkpoint.
        let rerouteMapRoute: Record<string, unknown> | null = null;
        if (binding.syncScope === 'AUTHENTICATED' && binding.savedRouteValidated) {
            const server = await transportFor(binding).current(binding);
            if (server?.rerouteValidated === true && typeof server.rerouteSnapshotJSON === 'string'
                && typeof server.routeFingerprint === 'string'
                && await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
                    server.rerouteSnapshotJSON) === server.routeFingerprint) {
                rerouteMapRoute = JSON.parse(server.rerouteSnapshotJSON) as Record<string, unknown>;
            }
            if (server?.state === 'ACTIVE' && server.rerouteValidated === true
                && server.generation === binding.generation + 1
                && server.routeRevision === binding.routeRevision + 1
                && typeof server.rerouteInputJSON === 'string' && server.rerouteInputJSON.length <= 1_048_576
                && typeof server.routeInputDigest === 'string') {
                const recovered = normalizeAutomaticJourneyBinding({ ...binding,
                    sessionId: server.sessionId, generation: server.generation,
                    routeRevision: server.routeRevision, routeInputDigest: server.routeInputDigest,
                    preparedAtEpochSeconds: typeof server.preparedAt === 'string' ? Date.parse(server.preparedAt) / 1000 : null,
                    expiresAtEpochSeconds: typeof server.expiresAt === 'string' ? Date.parse(server.expiresAt) / 1000 : null,
                    rerouteValidated: true, officialBusAdmission: server.rerouteBusAdmission,
                    officialSubwayAdmission: undefined, officialBusAdmissions: undefined, officialSubwayAdmissions: undefined,
                });
                if (!recovered || await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
                    server.rerouteInputJSON) !== recovered.routeInputDigest) throw new Error('INVALID_AUTOMATIC_SERVER_RESPONSE');
                const auth = await restoreAuthentication(recovered.expiresAtEpochSeconds);
                requireJourneyAuthenticationIdentity(auth, recovered as Required<AutomaticJourneyBinding>);
                await configureAutomaticJourneyAuthentication(auth);
                nativeAuthentication = auth;
                await configurePreparedJourneyRemoteUpdates(auth, recovered);
                // If the previous process persisted native first, merely align JS storage.
                let alreadyInstalled = false;
                try { alreadyInstalled = await readSavedAutomaticJourneyCheckpointRoute(recovered) === server.rerouteInputJSON; }
                catch { /* The old checkpoint is still present; replace it below. */ }
                if (!alreadyInstalled) {
                    const replaced = await replaceAutomaticJourney(server.rerouteInputJSON, recovered);
                    if (!replaced.enabled || replaced.status !== 'ACTIVE' || replaced.routeRevision !== recovered.routeRevision
                        || !replaced.departureAcknowledged) throw new Error(replaced.lastErrorCode ?? 'REROUTE_REPLACEMENT_REJECTED');
                    await AsyncStorage.setItem(BINDING_KEY, JSON.stringify(recovered));
                    current = recovered;
                    currentRouteJSON = server.rerouteInputJSON;
                    sourceSavedRouteJSON = JSON.stringify(input);
                    currentRerouteMapRoute = rerouteMapRoute;
                    rerouteCandidates = null;
                    publish({ status: 'ACKNOWLEDGED', errorCode: null, rerouteState: 'IDLE', rerouteCandidateCount: 0,
                        checkpointState: 'NONE' });
                    observeLifetime();
                    return replaced;
                }
                await AsyncStorage.setItem(BINDING_KEY, JSON.stringify(recovered));
                binding = recovered;
                routeJSON = undefined;
            }
        }
        // No native location/Activity/outbox restoration before authoritative server approval.
        if (binding.savedRouteValidated) {
            try { await transportFor(binding).validate(binding); }
            catch (error) {
                // Definitive revocation destroys the old checkpoint; transient outages leave it
                // quarantined for a later explicit restore without starting any native input.
                if (["AUTOMATIC_SERVER_REJECTED", "INVALID_AUTOMATIC_SERVER_RESPONSE", "AUTOMATIC_AUTH_REQUIRED", "AUTOMATIC_AUTH_CHANGED"].includes(codeFor(error))) {
                    await stopAutomaticJourneyTrial();
                }
                throw error;
            }
        }
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        if (binding.syncScope === "AUTHENTICATED") {
            const extended = binding.expiresAtEpochSeconds - binding.preparedAtEpochSeconds > 600.001;
            const auth = await restoreAuthentication(extended ? binding.expiresAtEpochSeconds : undefined);
            requireJourneyAuthenticationIdentity(auth, binding as Required<AutomaticJourneyBinding>);
            if (extended) requireJourneyAuthenticationLifetime(auth, binding.expiresAtEpochSeconds);
            if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
            if (!nativeAuthentication) await configureAutomaticJourneyAuthentication(auth);
            nativeAuthentication = auth;
            await configurePreparedJourneyRemoteUpdates(auth, binding);
        }
        if (savedCheckpoint) {
            routeJSON = await readSavedAutomaticJourneyCheckpointRoute(binding);
            if (journeyRouteUTF8Bytes(routeJSON) > JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes ||
                await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, routeJSON) !== binding.routeInputDigest) {
                throw new Error("ROUTE_BINDING_MISMATCH");
            }
            const saved = JSON.parse(routeJSON) as JourneyRouteInput;
            if (saved.routeRevision !== binding.routeRevision || !binding.rerouteValidated
                && savedWalkingBaseJSON(saved) !== savedWalkingBaseJSON(input))
                throw new Error("ROUTE_BINDING_MISMATCH");
            requireJourneyAuthenticationIdentity(await restoreAuthentication(), binding as Required<AutomaticJourneyBinding>);
        } else if (binding.rerouteValidated) {
            routeJSON = await readSavedAutomaticJourneyCheckpointRoute(binding);
            if (journeyRouteUTF8Bytes(routeJSON) > JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes ||
                await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, routeJSON) !== binding.routeInputDigest ||
                (JSON.parse(routeJSON) as JourneyRouteInput).routeRevision !== binding.routeRevision) {
                throw new Error('ROUTE_BINDING_MISMATCH');
            }
        }
        if (!routeJSON) throw new Error("CHECKPOINT_ROUTE_UNAVAILABLE");
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        restoreRequested = true;
        const snapshot = await restoreAutomaticJourney(routeJSON, binding);
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        if (!snapshot.enabled || snapshot.sessionId !== binding.sessionId || !["ARMED", "ACTIVE"].includes(snapshot.status)) {
            throw new Error(snapshot.lastErrorCode ?? "AUTOMATIC_RESTORE_FAILED");
        }
        current = binding;
        rerouteCandidates = null;
        nextRerouteLookupAt = 0;
        currentRouteJSON = routeJSON;
        sourceSavedRouteJSON = JSON.stringify(input);
        currentRerouteMapRoute = rerouteMapRoute;
        nextAutomaticRetryAt = 0;
        publish({ status: snapshot.departureAcknowledged ? "ACKNOWLEDGED" : snapshot.pendingDeparture ? "PENDING" : "IDLE",
            errorCode: null, rerouteState: 'IDLE', rerouteCandidateCount: 0,
            ...(savedCheckpoint && { checkpointState: 'NONE' as const }) });
        observeLifetime();
        retryAutomaticJourneySync().catch(() => undefined);
        return snapshot;
    } catch (error) {
        if (restoreRequested) await stopAutomaticJourney();
        if (!current) disposeLifetime?.();
        throw new Error(codeFor(error));
    }
    finally { operationBusy = false; }
}

export async function stopAutomaticJourneyTrial(): Promise<AutomaticJourneySnapshot> {
    if (!isAutomaticJourneyDevelopment()) return getAutomaticJourneySnapshot();
    if (stopping) return stopping;
    ++generation;
    const binding = current;
    const source = authenticationSource;
    current = null;
    pendingRerouteCommit = null;
    rerouteCommitInFlight = null;
    rerouteCandidates = null;
    nextRerouteLookupAt = 0;
    publish({ rerouteState: 'IDLE', rerouteCandidateCount: 0 });
    nativeAuthentication = null;
    currentRouteJSON = null;
    sourceSavedRouteJSON = null;
    currentRerouteMapRoute = null;
    disposeLifetime?.();
    stopping = (async () => {
        // Native revocation comes first. An HTTP error must never keep location or the outbox running.
        const snapshot = await stopAutomaticJourney();
        let persisted = binding;
        if (!persisted) {
            try {
                const raw = await AsyncStorage.getItem(BINDING_KEY);
                if (raw) {
                    if (raw.length > 4096) throw new Error();
                    persisted = normalizeAutomaticJourneyBinding(JSON.parse(raw));
                    if (!persisted) throw new Error();
                }
            } catch {
                // Local revocation succeeded, but remote ownership is unknown. Do not erase
                // unreadable evidence or report a successful server stop.
                publish({ status: 'BLOCKED', errorCode: 'STOP_BINDING_STORAGE_UNAVAILABLE', paused: false });
                return snapshot;
            }
        }
        if (persisted && persisted.syncScope !== "LOCAL_ONLY") {
            try { await stopOutbox.enqueue(persisted); }
            catch {
                // Retain the old binding if the durable intent cannot be written.
                publish({ status: 'BLOCKED', errorCode: 'STOP_OUTBOX_STORAGE_UNAVAILABLE', paused: false });
                return snapshot;
            }
        }
        await AsyncStorage.removeItem(BINDING_KEY).catch(() => undefined);
        await retryAutomaticJourneyStops(source ?? undefined);
        const result = stopOutbox.summary();
        publish({ status: result.pendingCount || result.errorCode ? 'RETRY_WAIT' : 'IDLE', paused: false, checkpointState: 'NONE',
            pendingStopCount: result.pendingCount, errorCode: result.errorCode ?? snapshot.lastErrorCode });
        return snapshot;
    })();
    try { return await stopping; } finally { stopping = null; authenticationSource = null; }
}

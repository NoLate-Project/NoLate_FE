import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";

import { subscribeAuthInvalidation } from "../auth/authStorage";
import {
    updateAutomaticJourneyAuthentication, configureAutomaticJourneyAuthentication, acknowledgeAutomaticJourneyDeparture, armAutomaticJourney, getAutomaticJourneyDeparture,
    getAutomaticJourneySnapshot, isAutomaticJourneyDevelopment, normalizeAutomaticJourneyBinding,
    restoreAutomaticJourney, stopAutomaticJourney, subscribeAutomaticJourney, reconcileAutomaticJourneyTerminal,
    type AutomaticJourneyBinding, type AutomaticJourneySnapshot,
} from "./automaticJourney";
import { journeyJSONRequest } from "./journeyJSONRequest";
import { authenticationMetadata, createAuthenticatedJourneyPost, currentJourneyAuthentication, requireJourneyAuthenticationIdentity, requireJourneyAuthenticationLifetime,
    type JourneyAuthentication, type JourneyAuthenticationSource } from "./automaticJourneyAuthentication";
import { createAutomaticJourneyTransport } from "./automaticJourneyTransport";
import { assessJourneyRouteInput } from "./journeyRouteAssessment";
import { JOURNEY_ROUTE_INPUT_LIMITS, journeyRouteUTF8Bytes, type JourneyRouteInput } from "./journeyRouteInput";
import { createJourneyStopOutbox } from './journeyStopOutbox';
import { requestWalkingSnapshot, savedWalkingBaseJSON } from './serverWalkingSnapshot';
import { getEnv } from '../../api/env';

const BINDING_KEY = "@nolate/automatic-journey-trial-binding-v1";
// Fixed isolated fixture endpoint. Never reads API configuration or attaches user auth tokens.
const SANDBOX_ORIGIN = "http://127.0.0.1:15543";
/** A physical iPhone is never allowed to send a SIMULATOR command to the server. */
export function journeyTrialExecution(scope: AutomaticJourneyBinding['syncScope'], physicalDevice =
    (require('expo-device') as typeof import('expo-device')).isDevice): AutomaticJourneyBinding['execution'] {
    if (!physicalDevice) return 'SIMULATOR';
    if (scope !== 'AUTHENTICATED'
        || getEnv('EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED') !== 'true') {
        throw new Error('DEVICE_FIELD_TEST_DISABLED');
    }
    return 'DEVICE';
}
export type AutomaticJourneySyncState = {
    status: "IDLE" | "PENDING" | "SENDING" | "ACKNOWLEDGED" | "RETRY_WAIT" | "BLOCKED";
    paused: boolean; errorCode: string | null;
    pendingStopCount?: number;
    checkpointState?: "NONE" | "CHECKING" | "CURRENT" | "CLEARED" | "WAITING" | "BLOCKED";
};
let syncState: AutomaticJourneySyncState = { status: "IDLE", paused: false, errorCode: null };
const listeners = new Set<(state: AutomaticJourneySyncState) => void>();
let current: AutomaticJourneyBinding | null = null;
let currentRouteJSON: string | null = null;
let preparingSavedRoute: { scheduleId: string; routeJSON: string } | null = null;
/** In-memory only: the selected input must exactly match the armed route. */
export function getAutomaticJourneyTrialBinding(input: JourneyRouteInput): AutomaticJourneyBinding | null {
    return getAutomaticJourneyTrialInput(input) ? { ...current! } : null;
}
export function getAutomaticJourneyTrialInput(input:JourneyRouteInput):JourneyRouteInput|null {
    if(!current||!currentRouteJSON)return null;
    const armed=JSON.parse(currentRouteJSON) as JourneyRouteInput;
    if(currentRouteJSON===JSON.stringify(input))return armed;
    return armed.walkingSnapshot && savedWalkingBaseJSON(armed)===savedWalkingBaseJSON(input) ? armed : null;
}
/** Call only with an authoritative update of this saved schedule, never a viewed participant/selection. */
export async function revalidateAutomaticJourneySavedRoute(scheduleId: string, input: JourneyRouteInput | null): Promise<boolean> {
    if (!isAutomaticJourneyDevelopment()) return false;
    const routeJSON = input ? savedWalkingBaseJSON(input) : null;
    const pending = preparingSavedRoute?.scheduleId === scheduleId ? preparingSavedRoute : null;
    const active = current?.savedRouteValidated && current.scheduleId === scheduleId;
    if (!pending && !active) return false;
    const expected=pending?.routeJSON ?? currentRouteJSON;
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

const codeFor = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.message)
    ? error.message : "AUTOMATIC_SYNC_UNAVAILABLE";
function publish(change: Partial<AutomaticJourneySyncState>) {
    syncState = { ...syncState, ...change };
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
            const result = await transportFor(binding, selectedSource).reconcile(binding);
            if (revision !== generation || current) return;
            if (await AsyncStorage.getItem(BINDING_KEY) !== raw) throw new Error('CHECKPOINT_BINDING_CHANGED');
            if (result === 'CURRENT') {
                publish({ checkpointState: 'CURRENT', errorCode: null });
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
    const result = await stopOutbox.drain(binding => transportFor(binding, source ?? authenticationSource ?? currentJourneyAuthentication).stop(binding));
    publish({ pendingStopCount: result.pendingCount, ...(result.pendingCount || result.errorCode
        ? { status: 'RETRY_WAIT', errorCode: result.errorCode ?? 'STOP_DELIVERY_PENDING' }
        : syncState.pendingStopCount ? { status: 'IDLE', errorCode: null } : {}) });
}

/** This pump outlives a screen. Native owns the persistent event; JS only transports/acknowledges it. */
function observeLifetime() {
    if (disposeLifetime) return;
    const automaticRetry = () => {
        retryAutomaticJourneyStops().catch(() => undefined);
        if (Date.now() >= nextAutomaticRetryAt) retryAutomaticJourneySync().catch(() => undefined);
    };
    const unsub = subscribeAutomaticJourney(snapshot => {
        if (current && snapshot.sessionId === current.sessionId && ['STOPPED', 'EXPIRED'].includes(snapshot.status)) {
            // A native terminal event also owns remote cleanup (including lease expiry and
            // permission revocation), not just an explicit UI stop/auth error.
            stopAutomaticJourneyTrial().catch(() => undefined);
            return;
        }
        if (snapshot.pendingDeparture) automaticRetry();
    });
    const app = AppState.addEventListener("change", state => {
        if (state === "active") automaticRetry();
    });
    const auth = subscribeAuthInvalidation(async () => { await stopAutomaticJourneyTrial(); });
    const timer = setInterval(() => {
        if (AppState.currentState === "active") automaticRetry();
    }, 5000);
    disposeLifetime = () => { unsub(); app.remove(); auth(); clearInterval(timer); disposeLifetime = null; };
}
export function setAutomaticJourneySyncPaused(paused: boolean) {
    publish({ paused });
    if (!paused) retryAutomaticJourneySync().catch(() => undefined);
}
export async function retryAutomaticJourneySync(): Promise<void> {
    if (!isAutomaticJourneyDevelopment() || !current || syncState.status === "BLOCKED") return;
    if (inFlight) return inFlight;
    const binding = current;
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
                    throw error;
                }
                if(revision!==generation||current!==binding)return;
            }
            const event = await getAutomaticJourneyDeparture(binding);
            if (revision !== generation || !event) return;
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
            if (revision !== generation) return;
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
    const savedCandidate = saved && copied.context === "SAVED_ROUTE" && scope !== "LOCAL_ONLY"
        && summary.reasonCodes.length === 1 && summary.reasonCodes[0] === "SAVED_ROUTE_REVALIDATION_REQUIRED"
        && first?.kind === "WALK" && first.geometryUsable;
    if (!(copied.context === "ROUTING_RESPONSE" && summary.eligibleDepartureLegIndex === 0) && !syntheticCandidate && !savedCandidate) {
        throw new Error("ROUTE_NOT_ELIGIBLE");
    }
    return { routeJSON, input: copied, digest: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, routeJSON) };
}

export async function prepareAutomaticJourneyTrial(input: JourneyRouteInput, scope: AutomaticJourneyBinding["syncScope"], savedScheduleId?: string, authSource?: JourneyAuthenticationSource): Promise<AutomaticJourneySnapshot> {
    if (!isAutomaticJourneyDevelopment()) throw new Error("DEVELOPMENT_IOS_ONLY");
    if (operationBusy || stopping) throw new Error("AUTOMATIC_OPERATION_PENDING");
    if (!["LOCAL_ONLY", "SANDBOX", "AUTHENTICATED"].includes(scope)) throw new Error("INVALID_SYNC_SCOPE");
    await retryAutomaticJourneyStops(authSource);
    if (stopOutbox.summary().pendingCount || stopOutbox.summary().errorCode) throw new Error('PENDING_STOP_BLOCKS_PREPARE');
    if (operationBusy || stopping) throw new Error('AUTOMATIC_OPERATION_PENDING');
    operationBusy = true;
    let revision = generation;
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
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
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
        }
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        // Only identity/digest/expiry persist in JS, never route coordinates or auth material.
        await AsyncStorage.setItem(BINDING_KEY, JSON.stringify(binding));
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        armRequested = true;
        const snapshot = await armAutomaticJourney(selected.routeJSON, binding);
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        if (!snapshot.enabled || snapshot.status !== "ARMED" || snapshot.sessionId !== binding.sessionId) {
            throw new Error(snapshot.lastErrorCode ?? snapshot.reason ?? "AUTOMATIC_PREPARATION_FAILED");
        }
        current = binding;
        currentRouteJSON = selected.routeJSON;
        nextAutomaticRetryAt = 0;
        publish({ status: "IDLE", errorCode: null, checkpointState: 'NONE' });
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

export async function restoreAutomaticJourneyTrial(input: JourneyRouteInput, authSource?: JourneyAuthenticationSource): Promise<AutomaticJourneySnapshot> {
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
        const binding = normalizeAutomaticJourneyBinding(JSON.parse(raw));
        if (!binding) throw new Error("TRIAL_BINDING_UNAVAILABLE");
        if (binding.execution !== journeyTrialExecution(binding.syncScope)) throw new Error('TRIAL_EXECUTION_MISMATCH');
        const selected = await selectedInput(input, binding.syncScope, binding.savedRouteValidated === true);
        if (selected.digest !== binding.routeInputDigest) throw new Error("ROUTE_BINDING_MISMATCH");
        if (binding.syncScope === "AUTHENTICATED") authenticationSource = authSource ?? currentJourneyAuthentication;
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
            const auth = await authenticationSource!(extended ? binding.expiresAtEpochSeconds : undefined);
            requireJourneyAuthenticationIdentity(auth, binding as Required<AutomaticJourneyBinding>);
            if (extended) requireJourneyAuthenticationLifetime(auth, binding.expiresAtEpochSeconds);
            if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
            await configureAutomaticJourneyAuthentication(auth);
            nativeAuthentication = auth;
        }
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        restoreRequested = true;
        const snapshot = await restoreAutomaticJourney(selected.routeJSON, binding);
        if (revision !== generation) throw new Error("AUTOMATIC_OPERATION_CANCELLED");
        if (!snapshot.enabled || snapshot.sessionId !== binding.sessionId || !["ARMED", "ACTIVE"].includes(snapshot.status)) {
            throw new Error(snapshot.lastErrorCode ?? "AUTOMATIC_RESTORE_FAILED");
        }
        current = binding;
        currentRouteJSON = selected.routeJSON;
        nextAutomaticRetryAt = 0;
        publish({ status: snapshot.departureAcknowledged ? "ACKNOWLEDGED" : snapshot.pendingDeparture ? "PENDING" : "IDLE", errorCode: null });
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
    nativeAuthentication = null;
    currentRouteJSON = null;
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

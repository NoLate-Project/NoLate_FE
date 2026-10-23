import {
    automaticRecord, normalizeAutomaticJourneyBinding,
    type AutomaticJourneyBinding, type AutomaticJourneyDeparture,
} from "./automaticJourney";

export type AutomaticJourneyPrepareRequest = {
    requestId: string; clientOwnerId: string; routeInputDigest: string; execution: AutomaticJourneyBinding["execution"];
    routeInputJSON?: string;
};
export type AutomaticJourneyPost = (path: string, body: Record<string, unknown>) => Promise<unknown>;

const base = (scheduleId: string) => {
    if (!/^[1-9]\d{0,17}$/.test(scheduleId)) throw new Error("INVALID_SCHEDULE_ID");
    return `/api/schedules/${scheduleId}/automatic-journey`;
};
function payload(value: unknown): Record<string, unknown> {
    const envelope = automaticRecord(value);
    const data = automaticRecord(envelope?.data);
    if (envelope?.success !== true || !data) throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE");
    return data;
}

/** Wire protocol only; the caller supplies a separately fenced credential/origin transport. */
export function createAutomaticJourneyTransport(post: AutomaticJourneyPost, authentication?: {
    apiOrigin: string; authMemberId: number; loginGeneration: number;
}) {
    return {
        async reconcile(binding: AutomaticJourneyBinding): Promise<"CURRENT" | "TERMINAL"> {
            const data = payload(await post(`${base(binding.scheduleId)}/${encodeURIComponent(binding.sessionId)}/reconcile`, {
                generation: binding.generation, routeRevision: binding.routeRevision,
                clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest,
            }));
            const checked = typeof data.checkedAt === "string" ? Date.parse(data.checkedAt) / 1000 : NaN;
            const now = Date.now() / 1000;
            if (data.schemaVersion !== 1 || data.sessionId !== binding.sessionId || data.scheduleId !== binding.scheduleId
                || data.generation !== binding.generation || data.routeRevision !== binding.routeRevision
                || data.clientOwnerId !== binding.clientOwnerId || data.routeInputDigest !== binding.routeInputDigest
                || data.execution !== binding.execution || typeof data.state !== "string"
                || !["ARMED", "ACTIVE", "STOPPED", "EXPIRED"].includes(data.state)
                || !Number.isFinite(checked) || checked < binding.preparedAtEpochSeconds || checked < now - 30 || checked > now + 5) {
                throw new Error("INVALID_AUTOMATIC_RECONCILIATION");
            }
            if (["ARMED", "ACTIVE"].includes(data.state)) return "CURRENT"; // Not approval to restore inputs.
            const ended = typeof data.endedAt === "string" ? Date.parse(data.endedAt) / 1000 : NaN;
            if (!Number.isFinite(ended) || ended < binding.preparedAtEpochSeconds || ended > checked) throw new Error("INVALID_AUTOMATIC_RECONCILIATION");
            return "TERMINAL";
        },
        async validate(binding: AutomaticJourneyBinding): Promise<void> {
            const data = payload(await post(`${base(binding.scheduleId)}/${encodeURIComponent(binding.sessionId)}/validate`, {
                generation: binding.generation, routeRevision: binding.routeRevision,
                clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest,
            }));
            const validated = typeof data.validatedAt === "string" ? Date.parse(data.validatedAt) / 1000 : NaN;
            const until = typeof data.validUntil === "string" ? Date.parse(data.validUntil) / 1000 : NaN;
            const now = Date.now() / 1000;
            if (data.schemaVersion !== 1 || data.sessionId !== binding.sessionId || data.scheduleId !== binding.scheduleId
                || data.generation !== binding.generation || data.routeRevision !== binding.routeRevision
                || data.clientOwnerId !== binding.clientOwnerId || data.routeInputDigest !== binding.routeInputDigest
                || data.execution !== binding.execution || typeof data.state !== "string" || !["ARMED", "ACTIVE"].includes(data.state)
                || !Number.isFinite(validated) || !Number.isFinite(until) || validated < binding.preparedAtEpochSeconds
                || validated > now + 5 || until <= now || until <= validated || until > validated + 30
                || until > binding.expiresAtEpochSeconds) throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE");
        },
        async prepare(scheduleId: string, request: AutomaticJourneyPrepareRequest): Promise<AutomaticJourneyBinding> {
            const data = payload(await post(`${base(scheduleId)}/${request.routeInputJSON ? "prepare-saved" : "prepare"}`, { ...request }));
            const binding = normalizeAutomaticJourneyBinding({
                sessionId: data.sessionId, scheduleId: data.scheduleId, generation: data.generation,
                routeRevision: data.routeRevision, clientOwnerId: data.clientOwnerId, routeInputDigest: data.routeInputDigest,
                preparedAtEpochSeconds: typeof data.preparedAt === "string" ? Date.parse(data.preparedAt) / 1000 : null,
                expiresAtEpochSeconds: typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) / 1000 : null,
                execution: data.execution, syncScope: authentication ? "AUTHENTICATED" : "SANDBOX",
                ...(authentication ?? {}),
                ...(request.routeInputJSON && data.savedRouteValidated === true ? { savedRouteValidated: true, guidanceEnabled: true } : {}),
                ...(request.routeInputJSON && data.officialBusAdmission != null ? { officialBusAdmission: data.officialBusAdmission } : {}),
                ...(request.routeInputJSON && data.officialSubwayAdmission != null ? { officialSubwayAdmission: data.officialSubwayAdmission } : {}),
            });
            if (!binding || data.state !== "ARMED" || data.sequence !== 0 || binding.sessionId !== request.requestId
                || binding.scheduleId !== scheduleId || binding.clientOwnerId !== request.clientOwnerId
                || binding.routeInputDigest !== request.routeInputDigest || binding.execution !== request.execution
                || request.routeInputJSON && data.savedRouteValidated !== true) {
                throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE");
            }
            return binding;
        },
        async depart(event: AutomaticJourneyDeparture): Promise<void> {
            const data = payload(await post(`${base(event.scheduleId)}/${encodeURIComponent(event.sessionId)}/departure`, {
                generation: event.generation, routeRevision: event.routeRevision, clientOwnerId: event.clientOwnerId,
                routeInputDigest: event.routeInputDigest, execution: event.execution, type: event.type,
                eventKey: event.eventKey, sequence: event.sequence,
                occurredAt: new Date(event.occurredAtEpochSeconds * 1000).toISOString(),
            }));
            if (data.accepted !== true || typeof data.duplicate !== "boolean" || data.state !== "ACTIVE"
                || data.sessionId !== event.sessionId || data.generation !== event.generation
                || data.routeRevision !== event.routeRevision || data.eventKey !== event.eventKey || data.sequence !== 1
                || typeof data.departedAt !== "string" || !Number.isFinite(Date.parse(data.departedAt))) {
                throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE");
            }
        },
        async stop(binding: AutomaticJourneyBinding): Promise<void> {
            const data = payload(await post(`${base(binding.scheduleId)}/${encodeURIComponent(binding.sessionId)}/stop`, {
                generation: binding.generation, routeRevision: binding.routeRevision,
                clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest,
            }));
            if (data.sessionId !== binding.sessionId || data.state !== "STOPPED") throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE");
        },
    };
}

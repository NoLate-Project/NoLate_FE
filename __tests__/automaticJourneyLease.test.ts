import { createAutomaticJourneyTransport } from "../src/modules/journey/automaticJourneyTransport";
import type { AutomaticJourneyBinding } from "../src/modules/journey/automaticJourney";

const now = Date.parse("2026-10-05T07:00:00Z") / 1000;
const binding: AutomaticJourneyBinding = {
    sessionId: "11111111-1111-4111-8111-111111111111", scheduleId: "9001", generation: 1, routeRevision: 1,
    clientOwnerId: "22222222-2222-4222-8222-222222222222", routeInputDigest: "a".repeat(64),
    execution: "SIMULATOR", syncScope: "SANDBOX", preparedAtEpochSeconds: now,
    expiresAtEpochSeconds: now + 600, savedRouteValidated: true, guidanceEnabled: true,
};
const lease = {
    schemaVersion: 1, sessionId: binding.sessionId, scheduleId: binding.scheduleId,
    generation: 1, routeRevision: 1, clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest,
    execution: "SIMULATOR", state: "ARMED", validatedAt: new Date(now * 1000).toISOString(),
    validUntil: new Date((now + 30) * 1000).toISOString(),
};
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now * 1000); });
afterEach(() => jest.useRealTimers());
it("posts only the identity fence, never coordinates or credentials", async () => {
    const post = jest.fn(async () => ({ success: true, data: lease }));
    await createAutomaticJourneyTransport(post).validate(binding);
    expect(post).toHaveBeenCalledWith(`/api/schedules/9001/automatic-journey/${binding.sessionId}/validate`, {
        generation: 1, routeRevision: 1, clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest,
    });
});
it.each([
    { schemaVersion: 2 }, { sessionId: binding.clientOwnerId }, { scheduleId: "9002" }, { generation: 2 },
    { routeRevision: 2 }, { clientOwnerId: binding.sessionId }, { routeInputDigest: "b".repeat(64) },
    { execution: "DEVICE" }, { state: "STOPPED" }, { state: "EXPIRED" },
    { validatedAt: "invalid" }, { validUntil: null },
    { validatedAt: new Date((now - 1) * 1000).toISOString() },
    { validatedAt: new Date((now + 6) * 1000).toISOString() },
    { validUntil: new Date(now * 1000).toISOString() },
    { validUntil: new Date((now + 31) * 1000).toISOString() },
])("rejects lease with mismatched identity, terminal state or invalid original time %j", async patch => {
    const transport = createAutomaticJourneyTransport(async () => ({ success: true, data: { ...lease, ...patch } }));
    await expect(transport.validate(binding)).rejects.toThrow("INVALID_AUTOMATIC_SERVER_RESPONSE");
});
it("expired cached response cannot extend a lease on receipt", async () => {
    jest.setSystemTime((now + 30) * 1000);
    await expect(createAutomaticJourneyTransport(async () => ({ success: true, data: lease })).validate(binding))
        .rejects.toThrow("INVALID_AUTOMATIC_SERVER_RESPONSE");
});

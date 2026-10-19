import { createJourneyStopOutbox } from '../src/modules/journey/journeyStopOutbox';
import type { AutomaticJourneyBinding } from '../src/modules/journey/automaticJourney';

const binding: AutomaticJourneyBinding = {
    sessionId: '11111111-1111-4111-8111-111111111111', clientOwnerId: '22222222-2222-4222-8222-222222222222',
    scheduleId: '9001', generation: 1, routeRevision: 1, routeInputDigest: 'a'.repeat(64), execution: 'SIMULATOR',
    syncScope: 'AUTHENTICATED', apiOrigin: 'http://127.0.0.1:15544', authMemberId: 7, loginGeneration: 2,
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600, savedRouteValidated: true, guidanceEnabled: true,
};
function fixture() {
    let raw: string | null = null;
    const storage = { getItem: jest.fn(async () => raw), setItem: jest.fn(async (_key: string, value: string) => { raw = value; }) };
    return { storage, raw: () => raw, outbox: createJourneyStopOutbox(storage) };
}
it('survives restart with only whitelisted session identity and removes on receipt', async () => {
    const f = fixture();
    await f.outbox.enqueue({ ...binding, accessToken: 'secret', latitude: 37 } as AutomaticJourneyBinding);
    expect(f.raw()).not.toMatch(/secret|latitude|accessToken/);
    const restarted = createJourneyStopOutbox(f.storage);
    const send = jest.fn(async () => undefined);
    expect(await restarted.drain(send)).toEqual({ pendingCount: 0, errorCode: null });
    expect(send).toHaveBeenCalledWith(binding);
    expect(JSON.parse(f.raw()!).bindings).toEqual([]);
});
it.each(['AUTOMATIC_AUTH_REQUIRED', 'AUTOMATIC_AUTH_CHANGED', 'AUTOMATIC_SERVER_UNAVAILABLE'])('retains intent on %s without a false success', async code => {
    const f = fixture(); await f.outbox.enqueue(binding);
    expect(await f.outbox.drain(async () => { throw new Error(code); })).toEqual({ pendingCount: 1, errorCode: code });
    expect(JSON.parse(f.raw()!).bindings).toEqual([binding]);
    expect(await f.outbox.drain(async () => undefined)).toEqual({ pendingCount: 0, errorCode: null });
});
it('serializes duplicate enqueue/drain and rejects a conflicting identity', async () => {
    const f = fixture(); await Promise.all([f.outbox.enqueue(binding), f.outbox.enqueue(binding)]);
    expect(JSON.parse(f.raw()!).bindings).toHaveLength(1);
    await expect(f.outbox.enqueue({ ...binding, authMemberId: 8 })).rejects.toThrow('STOP_BINDING_CONFLICT');
    const send = jest.fn(async () => undefined);
    await Promise.all([f.outbox.drain(send), f.outbox.drain(send)]);
    expect(send).toHaveBeenCalledTimes(1);
});
it('retains intent when receipt persistence fails; resend is idempotent', async () => {
    const f = fixture(); await f.outbox.enqueue(binding);
    f.storage.setItem.mockRejectedValueOnce(new Error('disk failure with sensitive contents'));
    expect(await f.outbox.drain(async () => undefined)).toEqual({ pendingCount: 1, errorCode: 'STOP_DELIVERY_UNAVAILABLE' });
    expect(JSON.parse(f.raw()!).bindings).toHaveLength(1);
    expect(await f.outbox.drain(async () => undefined)).toEqual({ pendingCount: 0, errorCode: null });
});
it('does not silently discard corrupt or oversized storage', async () => {
    const f = fixture(); f.storage.getItem.mockResolvedValue('{broken');
    const send = jest.fn();
    expect(await f.outbox.drain(send)).toEqual({ pendingCount: 0, errorCode: 'STOP_OUTBOX_INVALID' });
    expect(send).not.toHaveBeenCalled(); expect(f.storage.setItem).not.toHaveBeenCalled();
});

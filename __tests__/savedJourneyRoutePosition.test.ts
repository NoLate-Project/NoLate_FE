import { presentSavedJourneyRoutePosition } from '../src/modules/journey/savedJourneyRoutePosition';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';

const binding: AutomaticJourneyBinding = { sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001',
    generation: 1, routeRevision: 1, clientOwnerId: '22222222-2222-4222-8222-222222222222', routeInputDigest: 'a'.repeat(64),
    execution: 'SIMULATOR', syncScope: 'SANDBOX', savedRouteValidated: true, guidanceEnabled: true,
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600 };
const input = { routeRevision: 1, legs: ['WALK', 'BUS', 'WALK', 'SUBWAY', 'WALK'].map((kind, index) => ({ index, kind })) } as JourneyRouteInput;
const snapshot = (patch = {}) => ({ enabled: true, status: 'ACTIVE', sessionId: binding.sessionId, routeRevision: 1,
    guidance: { ...binding, schemaVersion: 1, sequence: 10, status: 'ACTIVE', phase: 'WALKING_TO_STOP', quality: 'GOOD',
        activeLegIndex: 0, walkProgress: 0.6, observedAt: 1020, validUntil: 1035, boardingConfirmed: false, ...patch } }) as unknown as AutomaticJourneySnapshot;
const position = (patch = {}, now = 1021, route = input) => presentSavedJourneyRoutePosition(snapshot(patch), binding, route, now);
it.each([0, 0.25, 0.6, 1])('positions walk %s within its own segment of the full trip', walkProgress => {
    expect(position({ walkProgress })).toEqual({ legIndex: 0, legProgress: walkProgress, barFraction: walkProgress / 5, waiting: false });
});
it('waiting stays at walk/bus boundary, never claims riding', () => {
    expect(position({ phase: 'WAITING', activeLegIndex: 1, walkProgress: 1 }))
        .toEqual({ legIndex: 0, legProgress: 1, barFraction: 0.2, waiting: true });
    expect(position({ phase: 'WAITING', activeLegIndex: 1 })).toBeNull();
});
it('time passing cannot move a marker and expiry hides it', () => {
    expect(position({}, 1021)).toEqual(position({}, 1034));
    expect(position({}, 1035)).toBeNull(); expect(position({}, Number.NaN)).toBeNull();
});
it.each([{ activeLegIndex: 1 }, { phase: 'BOARDING_CANDIDATE' }, { phase: 'RIDING' }, { quality: 'UNCERTAIN' },
    { generation: 2 }, { routeInputDigest: 'b'.repeat(64) }, { walkProgress: NaN }, { walkProgress: -1 },
    { walkProgress: 2 }, { walkProgress: null }, { observedAt: 1030 }, { validUntil: 1040 }])('hides invalid/conflicting position %j', patch => {
    expect(position(patch)).toBeNull();
});
it('rejects changed/invalid topology and retains 32 legs without merging', () => {
    expect(position({}, 1021, { ...input, routeRevision: 2 })).toBeNull();
    expect(position({}, 1021, { ...input, legs: [] })).toBeNull();
    expect(position({}, 1021, { ...input, legs: [{ ...input.legs[0], index: 3 }] })).toBeNull();
    const legs = Array.from({ length: 32 }, (_, index) => ({ ...input.legs[index === 0 ? 0 : 1], index }));
    expect(position({}, 1021, { ...input, legs })?.barFraction).toBe(0.6 / 32);
    expect(position({}, 1021, { ...input, legs: [...legs, { ...legs[0], index: 32 }] })).toBeNull();
});

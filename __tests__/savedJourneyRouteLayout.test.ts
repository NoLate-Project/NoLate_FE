import { presentSavedJourneyRouteLayout } from '../src/modules/journey/savedJourneyRouteLayout';
import { presentSavedJourneyRoutePosition } from '../src/modules/journey/savedJourneyRoutePosition';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';

const binding = { sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001', generation: 1, routeRevision: 1,
    clientOwnerId: '22222222-2222-4222-8222-222222222222', execution: 'SIMULATOR', syncScope: 'SANDBOX',
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600,
    routeInputDigest: 'a'.repeat(64), guidanceEnabled: true, savedRouteValidated: true } as AutomaticJourneyBinding;
const input = { routeRevision: 1, legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ index, kind, display: {
    durationMinutes: [2, 5, 2][index], distanceMeters: [100, 800, 100][index],
    lineName: kind === 'BUS' ? '601' : null, lineColor: kind === 'BUS' ? '#E8752B' : null } })) } as JourneyRouteInput;
const snapshot = { enabled: true, status: 'ACTIVE', sessionId: binding.sessionId, routeRevision: 1,
    guidanceRoute: { ...binding, legs: input.legs.map(leg => ({ index: leg.index, kind: leg.kind, ...leg.display })) },
    guidance: { ...binding, schemaVersion: 1, sequence: 10, status: 'ACTIVE', phase: 'WALKING_TO_STOP', quality: 'GOOD',
        activeLegIndex: 0, walkProgress: 0.6, observedAt: 1020, validUntil: 1035, boardingConfirmed: false } } as unknown as AutomaticJourneySnapshot;
const layout = (value = snapshot, route = input) => presentSavedJourneyRouteLayout(value, binding, route);
it('uses bounded provider labels/colors and 2:5:2 planned-time fractions', () => {
    const value = layout(); expect(value.basis).toBe('TIME'); expect(value.caption).toBe('예정 시간 비례');
    expect(value.legs.map(leg => leg.fraction)).toEqual([2 / 9, 5 / 9, 2 / 9]);
    expect(value.legs[1]).toMatchObject({ label: '601', color: '#E8752B' });
    expect(value.legs[0].label).toBe('도보');
});
it('maps fresh GPS inside the weighted first segment and waits at its end, not the bus end', () => {
    expect(presentSavedJourneyRoutePosition(snapshot, binding, input, 1021)?.barFraction).toBe(0.6 * (2 / 9));
    expect(presentSavedJourneyRoutePosition(snapshot, binding, input, 1034)?.barFraction).toBe(0.6 * (2 / 9));
    const waiting = { ...snapshot, guidance: { ...snapshot.guidance, phase: 'WAITING', activeLegIndex: 1, walkProgress: 1 } };
    expect(presentSavedJourneyRoutePosition(waiting, binding, input, 1021)?.barFraction).toBe(2 / 9);
    expect(presentSavedJourneyRoutePosition(waiting, binding, input, 1035)).toBeNull();
});
it('never mixes units: all distances are required when any duration is missing', () => {
    const route = { ...input, legs: input.legs.map(leg => ({ ...leg, display: { ...leg.display!, durationMinutes: null } })) };
    const value = { ...snapshot, guidanceRoute: { ...snapshot.guidanceRoute, legs: route.legs.map(leg => ({ index: leg.index, kind: leg.kind, ...leg.display })) } };
    expect(layout(value, route).basis).toBe('DISTANCE'); expect(layout(value, route).legs.map(leg => leg.fraction)).toEqual([0.1, 0.8, 0.1]);
    value.guidanceRoute.legs[1].distanceMeters = null;
    expect(layout(value, route).basis).toBe('EQUAL');
});
it.each(['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest'])('foreign %s metadata falls back without fabricated names/colors/weights', key => {
    const value = layout({ ...snapshot, guidanceRoute: { ...snapshot.guidanceRoute, [key]: 'foreign' } });
    expect(value.basis).toBe('EQUAL'); expect(value.legs[1]).toMatchObject({ label: '버스', color: '#2F963B' });
});
it('budgeted/legacy absent metadata stays equal even if the client input has time/name claims', () => {
    const value = { ...snapshot, guidanceRoute: { ...binding, legs: input.legs.map(({ index, kind }) => ({ index, kind })) } };
    expect(layout(value).basis).toBe('EQUAL'); expect(layout(value).legs[1].label).toBe('버스');
});
it('invalid values and names from a different original route cannot alter display', () => {
    const legs = input.legs.map(leg => ({ index: leg.index, kind: leg.kind, ...leg.display }));
    legs[1] = { ...legs[1], lineName: 'different', lineColor: '#112233', durationMinutes: 1441, distanceMeters: NaN };
    const value = layout({ ...snapshot, guidanceRoute: { ...binding, legs } });
    expect(value.basis).toBe('EQUAL'); expect(value.legs[1]).toMatchObject({ label: '버스', color: '#2F963B' });
});
it('preserves all 32 repeated legs, order, fractions and full accessible labels', () => {
    const route = { ...input, legs: Array.from({ length: 32 }, (_, index) => ({ ...input.legs[index === 0 ? 0 : 1], index })) };
    const value = layout({ ...snapshot, guidanceRoute: { ...binding, legs: route.legs.map(leg => ({ index: leg.index, kind: leg.kind, ...leg.display })) } }, route);
    expect(value.legs).toHaveLength(32); expect(value.legs.map(leg => leg.index)).toEqual(Array.from({ length: 32 }, (_, index) => index));
    expect(value.legs.reduce((sum, leg) => sum + leg.fraction, 0)).toBeCloseTo(1);
});

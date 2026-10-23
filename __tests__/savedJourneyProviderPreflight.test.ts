import { savedJourneyProviderPreflight } from '../src/modules/journey/savedJourneyProviderPreflight';
import { buildSavedJourneyInput } from '../src/modules/journey/savedJourneyGuidance';
import { savedJourneyProviderFixture, savedJourneySubwayProviderFixture } from '../test-support/savedJourneyProviderFixture';
jest.mock('../src/api/env', () => ({ getEnv: () => { throw new Error('NO_NETWORK_KEYS'); } }));

it('only admits local precheck, with official mapping and server/native recheck still required', () => {
    const { route, input } = savedJourneyProviderFixture();
    const result = savedJourneyProviderPreflight(input, route);
    expect(result.canAssess).toBe(true); expect(result.issue).toBeNull();
    expect(result.checks.filter(c => c.state === 'MISSING')).toEqual([]);
    expect(result.checks.at(-1)?.state).toBe('RECHECK_REQUIRED');
    expect(JSON.stringify(result)).not.toMatch(/999999|126\.9|37\.5665|accessToken|navigationReady/);
});
it('admits an owned single subway leg to server recheck, never treating local metadata as official proof', () => {
    const {route,input}=savedJourneySubwayProviderFixture();
    expect(input?.legs.map(leg=>leg.kind)).toEqual(['WALK','SUBWAY','WALK']);
    const blocked=savedJourneyProviderPreflight(input,route);
    expect(blocked.canAssess).toBe(false);
    const admitted=savedJourneyProviderPreflight(input,route,true);
    expect(admitted.issue).toBeNull();
    expect(admitted.checks.find(check=>check.code==='SUBWAY_CATALOG')?.state).toBe('RECHECK_REQUIRED');
    expect(JSON.stringify(admitted)).not.toMatch(/1002000222|127\.027539/);
});
it.each(['tmap', 'seoul-topis', 'UNKNOWN'])('does not admit unsupported provider %s from complete geometry alone', provider => {
    const f = savedJourneyProviderFixture(); f.route.provider = provider;
    const result = savedJourneyProviderPreflight(buildSavedJourneyInput(f.route, f.origin, f.destination), f.route);
    expect(result.canAssess).toBe(false);
    expect(result.checks.find(c => c.code === 'BUS_PROVIDER')?.state).toBe('MISSING');
});
it.each(['walking', 'bus', 'connection', 'raw-id', 'occurrence', 'namespace'])('blocks missing or conflicting %s without repairing the route', mode => {
    const f = savedJourneyProviderFixture(), bus = f.route.transitLegs[1];
    if (mode === 'walking') f.route.transitLegs[2].navigationEvidence.geometryInputComplete = false;
    if (mode === 'bus') bus.pathGeometrySource = 'DISPLAY_CONNECTOR';
    if (mode === 'connection') f.route.transitLegs[2].startCoord.lng += .002;
    if (mode === 'raw-id') bus.navigationEvidence.busIdentifiers.localRouteId = '999999998';
    if (mode === 'occurrence') bus.navigationEvidence.stopOccurrences[1].providerSequence = 9;
    if (mode === 'namespace') bus.routeCityCode = '2';
    const before = JSON.stringify(f.route);
    const result = savedJourneyProviderPreflight(buildSavedJourneyInput(f.route, f.origin, f.destination), f.route);
    expect(result.canAssess).toBe(false); expect(result.issue).toBeTruthy();
    expect(JSON.stringify(f.route)).toBe(before);
});
it('sends missing ODsay direction to official crosswalk without claiming readiness or changing the saved route', () => {
    const f = savedJourneyProviderFixture();
    delete f.route.transitLegs[1].navigationEvidence.directionName;
    const before = JSON.stringify(f.route);
    const result = savedJourneyProviderPreflight(buildSavedJourneyInput(f.route, f.origin, f.destination), f.route);
    expect(result.canAssess).toBe(true);
    expect(result.checks.find(c => c.code === 'SERVER_NATIVE')?.state).toBe('RECHECK_REQUIRED');
    expect(JSON.stringify(f.route)).toBe(before);
});
it('does not borrow IDs from a different saved input or accept missing raw metadata', () => {
    const f = savedJourneyProviderFixture();
    const other = { ...f.input, legs: f.input.legs.map(leg => leg.index === 1 ? { ...leg, directionName: '다른 방면' } : leg) };
    expect(savedJourneyProviderPreflight(other, f.route).checks.find(c => c.code === 'SAVED_INPUT_MATCH')?.state).toBe('MISSING');
    expect(savedJourneyProviderPreflight(f.input, undefined).canAssess).toBe(false);
    expect(savedJourneyProviderPreflight({ ...f.input, destination: { ...f.input.destination!, longitude: 127 } }, f.route).canAssess).toBe(false);
    expect(savedJourneyProviderPreflight(null, f.route).canAssess).toBe(false);
});
it('accepts one unambiguous nested saved route but rejects duplicate wrapper arrays', () => {
    const f = savedJourneyProviderFixture();
    expect(savedJourneyProviderPreflight(f.input, { routeInfo: f.route }).canAssess).toBe(true);
    expect(savedJourneyProviderPreflight(f.input, { ...f.route, routeInfo: f.route }).canAssess).toBe(false);
});
it('bounds corrupt raw input and never echoes raw fields', () => {
    const f = savedJourneyProviderFixture();
    const route = { ...f.route, transitLegs: Array(33).fill({ rawSecret: 'DO_NOT_ECHO' }) };
    const result = savedJourneyProviderPreflight(f.input, route);
    expect(result.canAssess).toBe(false); expect(JSON.stringify(result)).not.toContain('DO_NOT_ECHO');
});

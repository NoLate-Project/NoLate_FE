import * as core from '../src/modules/map/tmapApiCore';
import { getWalkingAlternatives, getWalkingRouteViaTmap } from '../src/modules/map/tmapRouteProviders';
import { pedestrianGeometryFixture } from '../src/modules/journey/pedestrianGeometryFixtures';
import { buildJourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
jest.mock('../src/api/env', () => ({ getEnv: jest.fn(() => undefined) }));
const mockPost = jest.fn();
beforeEach(() => {
    mockPost.mockReset();
    jest.spyOn(core, 'tmapClient').mockReturnValue({ post: mockPost } as unknown as ReturnType<typeof core.tmapClient>);
});
afterEach(() => jest.restoreAllMocks());
test('existing HTTPS pedestrian call requests WGS84/index and binds raw response to request snapshot', async () => {
    const f = pedestrianGeometryFixture('complete');
    let resolve!: (v: unknown) => void;
    mockPost.mockReturnValue(new Promise(r => { resolve = r; }));
    const pending = getWalkingRouteViaTmap(f.origin, f.destination);
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('/tmap/routes/pedestrian');
    expect(body).toContain('sort=index'); expect(body).toContain('resCoordType=WGS84GEO');
    expect(body).toContain('reqCoordType=WGS84GEO');
    f.origin.lat = 0;
    resolve({ data: f.data });
    const parsed = await pending;
    expect(parsed.pedestrianGeometry).toMatchObject({ ok: true, request: { origin: { lat: 37.5665, lng: 126.978 } } });
    expect(mockPost).toHaveBeenCalledTimes(1);
});
test('walking alternatives retain separate raw candidates without turning them into transit evidence', async () => {
    const f = pedestrianGeometryFixture('complete'); mockPost.mockResolvedValue({ data: f.data });
    const alternatives = await getWalkingAlternatives(f.origin, f.destination);
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives[0].pedestrianGeometry).toMatchObject({ ok: true, rawLinePointCount: 4 });
    expect(alternatives[0].transitLegs).toBeUndefined();
    expect(buildJourneyRouteInput(alternatives[0], { routeRevision: 1, context: 'ROUTING_RESPONSE',
        origin: f.origin, destination: f.destination })).toEqual({ ok: false, reason: 'TRANSIT_ROUTE_REQUIRED' });
    expect(mockPost).toHaveBeenCalledTimes(2); // Existing two search options, no extra request added.
});
test('display route still renders on rejected raw input, but candidate remains rejected', async () => {
    const f = pedestrianGeometryFixture('gap'); mockPost.mockResolvedValue({ data: f.data });
    expect(await getWalkingRouteViaTmap(f.origin, f.destination)).toMatchObject({
        pathCoords: expect.any(Array), pedestrianGeometry: { ok: false, reason: 'DISCONNECTED_LINES' } });
    expect(mockPost).toHaveBeenCalledTimes(1);
});

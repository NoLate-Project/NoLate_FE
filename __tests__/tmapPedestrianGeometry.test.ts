import { parseTmapPedestrianGeometry } from '../src/modules/map/tmapPedestrianGeometry';
import { pedestrianGeometryFixture } from '../src/modules/journey/pedestrianGeometryFixtures';

const run = (f = pedestrianGeometryFixture('complete')) => parseTmapPedestrianGeometry(f.data, f.origin, f.destination);
const failure = (reason: string) => ({ ok: false, reason });
test('preserves raw order and collapses only the adjacent shared endpoint, without mutating input', () => {
    const f = pedestrianGeometryFixture('complete'), before = JSON.stringify(f);
    expect(run(f)).toMatchObject({ ok: true, provider: 'tmap', source: 'PEDESTRIAN_FEATURE_COLLECTION',
        version: 1, request: { origin: f.origin, destination: f.destination }, rawLinePointCount: 4,
        lineCount: 2, coordinates: [f.origin, { lat: 37.5665, lng: 126.9785 }, f.destination] });
    expect(JSON.stringify(f)).toBe(before);
});
test.each([['gap', 'DISCONNECTED_LINES'], ['invalid', 'INVALID_COORDINATE'], ['endpoint', 'ENDPOINT_MISMATCH']] as const)(
    'rejects %s as a whole instead of repairing it', (id, reason) => expect(run(pedestrianGeometryFixture(id))).toEqual(failure(reason)));
test.each([null, {}, [], { type: 'FeatureCollection', features: [] }, { type: 'Other', features: [1] }])(
    'rejects malformed response %p', data => expect(parseTmapPedestrianGeometry(data, { lat: 1, lng: 1 }, { lat: 1, lng: 2 })).toEqual(failure('INVALID_RESPONSE')));
test.each([null, { lat: '37.5665', lng: 126.978 }, { lat: Infinity, lng: 0 }, { lat: 91, lng: 0 }])(
    'rejects invalid independent request %p', value => {
        const f = pedestrianGeometryFixture('complete');
        expect(parseTmapPedestrianGeometry(f.data, value, f.destination)).toEqual(failure('INVALID_REQUEST'));
    });
test('rejects identical request endpoints', () => {
    const f = pedestrianGeometryFixture('complete');
    expect(parseTmapPedestrianGeometry(f.data, f.origin, f.origin)).toEqual(failure('INVALID_REQUEST'));
});
test.each([0, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects out-of-order/invalid feature index %p', index => {
    const f = pedestrianGeometryFixture('complete'); f.data.features[1].properties.index = index;
    expect(run(f)).toEqual(failure('FEATURE_ORDER'));
});
test('does not sort reversed provider features', () => {
    const f = pedestrianGeometryFixture('complete'); f.data.features.reverse();
    expect(run(f)).toEqual(failure('FEATURE_ORDER'));
});
test.each([[null, 37.5665], ['126.978', 37.5665], [200, 37], [126, 91], [126, NaN], [126, 37, 0], []].map(point => ({ point })))(
    'does not coerce/drop/repair line coordinate $point', ({ point }) => {
        const f = pedestrianGeometryFixture('complete'); f.data.features[0].geometry.coordinates[1] = point;
        expect(run(f)).toEqual(failure('INVALID_COORDINATE'));
    });
test('rejects sparse coordinates', () => {
    const f = pedestrianGeometryFixture('complete'); delete f.data.features[0].geometry.coordinates[0];
    expect(run(f)).toEqual(failure('INVALID_COORDINATE'));
});
test('rejects feature and point limits instead of display sampling', () => {
    const f = pedestrianGeometryFixture('complete');
    f.data.features = Array(4097).fill(f.data.features[0]); expect(run(f)).toEqual(failure('INPUT_LIMIT'));
    const g = pedestrianGeometryFixture('complete');
    g.data.features[0].geometry.coordinates = Array(2001).fill([126.978, 37.5665]);
    expect(run(g)).toEqual(failure('INPUT_LIMIT'));
});
test('rejects long segments rather than densifying an unproven straight line', () => {
    const f = pedestrianGeometryFixture('complete'); f.data.features[0].geometry.coordinates[1] = [126.99, 37.5665];
    expect(run(f)).toEqual(failure('SEGMENT_TOO_LONG'));
});
test('rejects zero length geometry', () => {
    const f = pedestrianGeometryFixture('complete'); f.data.features = [f.data.features[0]];
    f.data.features[0].geometry.coordinates = [[126.978, 37.5665], [126.978, 37.5665]];
    expect(run(f)).toEqual(failure('EMPTY_PATH'));
});
test('copies result coordinates and request endpoints independently of caller objects', () => {
    const f = pedestrianGeometryFixture('complete'), r = run(f);
    f.origin.lat = 0; f.data.features[0].geometry.coordinates[0] = [0, 0];
    expect(r).toMatchObject({ ok: true, request: { origin: { lat: 37.5665, lng: 126.978 } },
        coordinates: [ { lat: 37.5665, lng: 126.978 }, expect.anything(), expect.anything() ] });
});

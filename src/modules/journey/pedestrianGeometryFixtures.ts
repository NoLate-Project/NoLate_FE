/** Synthetic public-area coordinates only; never an actual provider response or saved route. */
export function pedestrianGeometryFixture(id: 'complete' | 'gap' | 'invalid' | 'endpoint') {
    const origin = { lat: 37.5665, lng: 126.978 };
    const middle = [126.9785, 37.5665];
    const destination = { lat: 37.5665, lng: 126.979 };
    const line = (index: number, coordinates: unknown[]) => ({ type: 'Feature', properties: { index },
        geometry: { type: 'LineString', coordinates } });
    return { origin, destination: id === 'endpoint' ? { ...destination, lat: 37.57 } : destination,
        data: { type: 'FeatureCollection', features: [
            line(0, [[origin.lng, origin.lat], id === 'invalid' ? [null, 37.5665] : middle]),
            line(1, [id === 'gap' ? [126.97851, 37.5665] : middle, [destination.lng, destination.lat]]),
        ] } };
}

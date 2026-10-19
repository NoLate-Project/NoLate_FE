import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Read-only QA probe of endpoints published by https://bus.go.kr/app/app.js.
// Not a production provider adapter. Never stores vehicle identifiers or sends user location/keys.
export function summarize(response) {
  const vo = response?.ResponseVO;
  assert.equal(vo?.code, 0, 'Official source did not return success');
  const data = vo.data;
  assert.ok(Array.isArray(data?.resultRouteStop) && Array.isArray(data?.resultRouteBuspos));
  const stops = data.resultRouteStop.filter(s => s.seq >= 44 && s.seq <= 48);
  assert.deepEqual(stops.map(s => s.seq), [44, 45, 46, 47, 48]);
  assert.deepEqual(stops.map(s => s.arsId), ['02007', '02128', '02137', '01118', '01116']);
  for (const s of stops) {
    assert.equal(s.busRouteId, 100100447); assert.equal(s.busRouteNm, '7016');
    assert.equal(s.direction, '상명대');
    assert.ok(Number.isFinite(s.gpsY) && s.gpsY > 37 && s.gpsY < 38);
    assert.ok(Number.isFinite(s.gpsX) && s.gpsX > 126 && s.gpsX < 128);
  }
  const vehicles = data.resultRouteBuspos;
  assert.ok(vehicles.length > 0, 'No operating vehicles observed; do not fabricate one');
  for (const v of vehicles) {
    assert.equal(v.rtId, 100100447);
    assert.match(v.dataTm, /^\d{14}$/);
    assert.ok(Number.isFinite(v.gpsX) && Number.isFinite(v.gpsY));
    assert.ok(Number.isInteger(v.sectOrd) && Number.isInteger(v.vehId));
  }
  return {
    source: 'https://bus.go.kr/', observedAt: vo.timestamp, routeId: '100100447', routeName: '7016',
    direction: '상명대', stops: stops.map(s => ({ sequence: s.seq, stationId: String(s.station),
      arsId: s.arsId, name: s.stationName, latitude: s.gpsY, longitude: s.gpsX })),
    observedVehicleCount: vehicles.length, observedDirections: [...new Set(vehicles.map(v => v.adirection))],
    sourceTimeRange: [vehicles.map(v => v.dataTm).sort()[0], vehicles.map(v => v.dataTm).sort().at(-1)],
    routeShapePointCount: data.resultRoutePath?.length ?? 0,
    navigationCertified: false, passengerVehicleAssociation: false,
    warning: 'Public web observation only; not ODsay crosswalk, walking route, source SLA, or boarding proof. Shape section ordinals must not be equated with stop sequence.',
  };
}

async function main() {
  const r = await fetch('https://bus.go.kr/sbus/bus/selectBusposInfo.do?routeId=100100447&isLowBus=0', {
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  assert.equal(r.status, 200);
  const bytes = await r.text(); assert.ok(Buffer.byteLength(bytes) < 2_000_000);
  console.log(JSON.stringify(summarize(JSON.parse(bytes)), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('PUBLIC_7016_PROBE_FAILED: no navigation certification'); process.exitCode = 1; });
}

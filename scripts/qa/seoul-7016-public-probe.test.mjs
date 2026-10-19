import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './seoul-7016-public-probe.mjs';
const fixture = () => ({ ResponseVO: { code: 0, timestamp: '2026-10-07T12:47:43', data: {
  resultRouteStop: ['02007', '02128', '02137', '01118', '01116'].map((arsId, i) => ({ seq: 44+i,
    arsId, busRouteId: 100100447, busRouteNm: '7016', direction: '상명대', gpsY: 37.56, gpsX: 126.97, station: 101000007+i })),
  resultRouteBuspos: [{ rtId: 100100447, dataTm: '20261007124720', gpsY: 37.56, gpsX: 126.97, sectOrd: 44, vehId: 123,
    plainNo: 'test-sensitive-field', adirection: '상명대' }], resultRoutePath: [],
} } });
test('summary is redacted and never certifies boarding or navigation', () => {
  const s = summarize(fixture()); assert.equal(s.navigationCertified, false); assert.equal(s.passengerVehicleAssociation, false);
  assert.ok(!JSON.stringify(s).includes('vehId')); assert.ok(!JSON.stringify(s).includes('test-sensitive-field'));
});
test('changed order, direction, namespace and malformed observation fail closed', () => {
  for (const change of [j => j.ResponseVO.code=1, j => j.ResponseVO.data.resultRouteStop.reverse(),
    j => j.ResponseVO.data.resultRouteStop[0].direction='은평차고지', j => j.ResponseVO.data.resultRouteStop[0].arsId='2007',
    j => j.ResponseVO.data.resultRouteBuspos[0].rtId=1, j => j.ResponseVO.data.resultRouteBuspos[0].dataTm='unknown',
    j => j.ResponseVO.data.resultRouteBuspos=[]]) {
    const j=fixture(); change(j); assert.throws(() => summarize(j));
  }
});

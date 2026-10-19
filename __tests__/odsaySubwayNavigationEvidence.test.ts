jest.mock('../src/api/env', () => ({getEnv: jest.fn(() => undefined)}));
import {parseTransitOptionsFromOdsay} from '../src/modules/map/odsayApi';

const rawLeg = () => ({trafficType: 1, duration: 10, distance: 3000, stationCount: 2,
    startID: 222, endID: 224, startName: '합성 출발역', endName: '합성 도착역',
    startX: 127.0276, startY: 37.4979, endX: 127.02, endY: 37.48, way: '합성 방면', wayCode: 2,
    lane: [{name: '수도권 2호선', subwayCode: 2, subwayCityCode: 1000}],
    graph: '127.0276 37.4979|127.02 37.48',
    passStopList: {stations: [
        {index: 10, stationID: 222, stationName: '합성 출발역', x: 127.0276, y: 37.4979},
        {index: 20, stationID: 223, stationName: '합성 중간역', x: 127.025, y: 37.49},
        {index: 30, stationID: 224, stationName: '합성 도착역', x: 127.02, y: 37.48},
    ]},
});
function parse(leg: unknown) {
    const options = parseTransitOptionsFromOdsay({result: {paths: [{pathType: 2, totalTime: 10, totalDistance: 3000,
        totalPayment: 1550, rps: [leg]}]}});
    return options[0]?.transitLegs?.[0];
}
test('preserves raw subway namespace IDs and original ordered station occurrences apart from display codes', () => {
    const evidence = parse(rawLeg())?.navigationEvidence;
    expect(evidence?.subwayIdentifiers).toEqual({startID: '222', endID: '224', wayCode: '2',
        lanes: [{sourceIndex: 0, subwayCode: '2', subwayCityCode: '1000'}]});
    expect(evidence?.stopOccurrences.map(s => [s.sourceIndex, s.providerSequence, s.routingStationID]))
        .toEqual([[0, 10, '222'], [1, 20, '223'], [2, 30, '224']]);
    expect(evidence?.busIdentifiers).toBeUndefined();
    expect(evidence?.declaredStationCount).toBe(2);
});
test('repeated subway stations and malformed rows are not deduplicated reordered or rebased', () => {
    const leg = rawLeg();
    leg.passStopList.stations = [leg.passStopList.stations[2], leg.passStopList.stations[0],
        leg.passStopList.stations[0], null as never];
    const rows = parse(leg)?.navigationEvidence?.stopOccurrences;
    expect(rows?.map(s => [s.sourceIndex, s.providerSequence, s.routingStationID]))
        .toEqual([[0, 30, '224'], [1, 10, '222'], [2, 10, '222'], [3, undefined, undefined]]);
});
test('multiple lane occurrences stay multiple including missing or invalid rows', () => {
    const leg = rawLeg();
    leg.lane = [leg.lane[0], {name: '다른 호선', subwayCode: 4, subwayCityCode: 1000}, null as never];
    expect(parse(leg)?.navigationEvidence?.subwayIdentifiers?.lanes).toEqual([
        {sourceIndex: 0, subwayCode: '2', subwayCityCode: '1000'},
        {sourceIndex: 1, subwayCode: '4', subwayCityCode: '1000'},
        {sourceIndex: 2, subwayCode: undefined, subwayCityCode: undefined},
    ]);
});
test('raw string IDs keep leading zeroes and raw direction without mapping to Seoul codes', () => {
    const leg = rawLeg() as any;
    leg.startID = '00222'; leg.endID = '00224'; leg.wayCode = '02';
    leg.passStopList.stations[0].stationID = '00222';
    expect(parse(leg)?.navigationEvidence?.subwayIdentifiers).toMatchObject({startID: '00222', endID: '00224', wayCode: '02'});
    expect(parse(leg)?.navigationEvidence?.stopOccurrences[0].routingStationID).toBe('00222');
});
test('missing raw IDs do not use legacy aliases local IDs names coordinates or display fields', () => {
    const leg = rawLeg() as any;
    delete leg.startID; leg.startId = 222; delete leg.endID; leg.endId = 224;
    delete leg.passStopList.stations[0].stationID;
    Object.assign(leg.passStopList.stations[0], {stationId: 222, localStationID: '999', code: '222'});
    expect(parse(leg)?.navigationEvidence?.subwayIdentifiers).toMatchObject({startID: undefined, endID: undefined});
    expect(parse(leg)?.navigationEvidence?.stopOccurrences[0].routingStationID).toBeUndefined();
});
test.each([true, {}, [], Number.MAX_SAFE_INTEGER + 1, -1, 1.5])('unsupported or unsafe raw identifier %p stays absent', value => {
    const leg = rawLeg() as any;
    leg.startID = value; leg.passStopList.stations[0].stationID = value;
    expect(parse(leg)?.navigationEvidence?.subwayIdentifiers?.startID).toBeUndefined();
    expect(parse(leg)?.navigationEvidence?.stopOccurrences[0].routingStationID).toBeUndefined();
});
test('excessive lane count omits the complete subway identity rather than truncating', () => {
    const leg = rawLeg(); leg.lane = Array.from({length: 65}, () => leg.lane[0]);
    expect(parse(leg)?.navigationEvidence?.subwayIdentifiers).toBeUndefined();
});
test('bus input does not acquire subway identity or station ID namespace', () => {
    const leg = {...rawLeg(), trafficType: 2, lane: [{busNo: '합성 버스', busID: 1}]};
    expect(parse(leg)?.navigationEvidence?.subwayIdentifiers).toBeUndefined();
    expect(parse(leg)?.navigationEvidence?.stopOccurrences.every(s => s.routingStationID === undefined)).toBe(true);
});

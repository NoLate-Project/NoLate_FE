import {loadSubwayObservationDiagnostic, parseSubwayObservationDiagnostic, subwayDiagnosticCases} from '../src/modules/journey/subwayObservationDiagnostic';
jest.mock('../src/modules/journey/journeyJSONRequest', () => ({journeyJSONRequest: jest.fn()}));
import {journeyJSONRequest} from '../src/modules/journey/journeyJSONRequest';
const summary = () => ({schemaVersion: 1, fixtureOnly: true, realProvider: false, gpsUsed: false, case: 'complete',
    status: 'TRAIN_REFERENCES_ONLY', matchingTrainCount: 1, providerCalls: 1, authorityReads: 2, redirectTrapCalls: 0,
    navigationReady: false, passengerBoardingConfirmed: false, passengerRemainingStops: null, passengerPosition: null});
beforeEach(() => jest.clearAllMocks());
test('diagnostic discards raw train identity and never grants navigation or passenger projection', () => {
    const result = parseSubwayObservationDiagnostic({...summary(), trainId: 'PRIVATE', coordinate: {lat: 1}}, 'complete');
    expect(result).toEqual({case: 'complete', status: 'TRAIN_REFERENCES_ONLY', matchingTrainCount: 1, providerCalls: 1, authorityReads: 2});
    expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(result).not.toHaveProperty('navigationReady');
});
test.each(['schemaVersion', 'fixtureOnly', 'realProvider', 'gpsUsed', 'case', 'status', 'matchingTrainCount',
    'providerCalls', 'authorityReads', 'redirectTrapCalls', 'navigationReady', 'passengerBoardingConfirmed', 'passengerRemainingStops', 'passengerPosition'])(
    'invalid %s cannot become a successful observation', key => {
        expect(() => parseSubwayObservationDiagnostic({...summary(), [key]: 'invalid'}, 'complete')).toThrow('INVALID_SUBWAY_DIAGNOSTIC');
    });
test.each([{matchingTrainCount: -1}, {matchingTrainCount: 501}, {matchingTrainCount: 1.5}, {providerCalls: 2},
    {authorityReads: 1}, {passengerBoardingConfirmed: true}, {navigationReady: true}, {passengerPosition: {latitude: 1}},
    {passengerRemainingStops: 1}, {redirectTrapCalls: 1}, {status: 'SAVED_ROUTE_CHANGED', matchingTrainCount: 1}])(
    'inconsistent or positive passenger capabilities are rejected', change => {
        expect(() => parseSubwayObservationDiagnostic({...summary(), ...change}, 'complete')).toThrow('INVALID_SUBWAY_DIAGNOSTIC');
    });
test('a blocked catalog response has zero matches and zero provider calls', () => {
    expect(parseSubwayObservationDiagnostic({...summary(), case: 'catalog-missing', status: 'STATION_CROSSWALK_REQUIRED',
        matchingTrainCount: 0, providerCalls: 0}, 'catalog-missing')).toMatchObject({matchingTrainCount: 0, providerCalls: 0});
});
test('missing raw routing identifiers cannot issue catalog or provider lookups', () => {
    const raw = {...summary(), case: 'raw-missing', status: 'RAW_SUBWAY_IDENTIFIERS_REQUIRED', matchingTrainCount: 0, providerCalls: 0};
    expect(parseSubwayObservationDiagnostic(raw, 'raw-missing')).toMatchObject({providerCalls: 0});
    expect(() => parseSubwayObservationDiagnostic({...raw, providerCalls: 1}, 'raw-missing')).toThrow();
    expect(() => parseSubwayObservationDiagnostic({...raw, authorityReads: 1}, 'raw-missing')).toThrow();
});
test('fixed loopback request only and unknown scenario makes no request', async () => {
    (journeyJSONRequest as jest.Mock).mockResolvedValue(summary());
    await expect(loadSubwayObservationDiagnostic('complete')).resolves.toMatchObject({matchingTrainCount: 1});
    expect(journeyJSONRequest).toHaveBeenCalledWith('http://127.0.0.1:15547/__fixture/subway-check', {case: 'complete'});
    (journeyJSONRequest as jest.Mock).mockClear();
    await expect(loadSubwayObservationDiagnostic('unknown' as 'complete')).rejects.toThrow('INVALID_SUBWAY_DIAGNOSTIC');
    expect(journeyJSONRequest).not.toHaveBeenCalled(); expect(subwayDiagnosticCases).toHaveLength(22);
});
test.each(['catalog-branches','catalog-express'] as const)('independent %s references remain train observations only',selected=>{
    const value=parseSubwayObservationDiagnostic({...summary(),case:selected,matchingTrainCount:selected==='catalog-branches'?2:1},selected);
    expect(value.matchingTrainCount).toBe(selected==='catalog-branches'?2:1);expect(value).not.toHaveProperty('passengerPosition');
});
test('ambiguous service pattern cannot have a chosen train or skip actual ownership checks',()=>{
    const value={...summary(),case:'catalog-ambiguous',status:'SERVICE_PATTERN_AMBIGUOUS',matchingTrainCount:0};
    expect(parseSubwayObservationDiagnostic(value,'catalog-ambiguous').matchingTrainCount).toBe(0);
    for(const change of [{matchingTrainCount:1},{providerCalls:0},{authorityReads:1}])
        expect(()=>parseSubwayObservationDiagnostic({...value,...change},'catalog-ambiguous')).toThrow();
});
test('expired catalog is unavailable before or after I O and never grants passenger navigation',()=>{
    const value={...summary(),case:'catalog-expired',status:'CATALOG_UNAVAILABLE',matchingTrainCount:0,providerCalls:0,authorityReads:1};
    expect(parseSubwayObservationDiagnostic(value,'catalog-expired')).toMatchObject({matchingTrainCount:0,providerCalls:0});
    expect(parseSubwayObservationDiagnostic({...value,providerCalls:1,authorityReads:2},'catalog-expired')).toMatchObject({matchingTrainCount:0});
    expect(()=>parseSubwayObservationDiagnostic({...value,navigationReady:true},'catalog-expired')).toThrow();
});
test('an ordinary candidate cannot turn unresolved loop occurrence into a chosen train',()=>{
    const value={...summary(),case:'catalog-loop-shadow',status:'STATION_CROSSWALK_REQUIRED',matchingTrainCount:0,providerCalls:0};
    expect(parseSubwayObservationDiagnostic(value,'catalog-loop-shadow')).toMatchObject({matchingTrainCount:0,providerCalls:0});
    for(const change of [{matchingTrainCount:1},{providerCalls:1}])
        expect(()=>parseSubwayObservationDiagnostic({...value,...change},'catalog-loop-shadow')).toThrow();
});
test.each(['automatic-stopped','automatic-replaced','automatic-revoked','automatic-edited','automatic-generation'] as const)(
    '%s never yields passenger position or a selected train',selected=>{
        const value={...summary(),case:selected,status:selected==='automatic-revoked'?'OWNER_CHANGED':'AUTOMATIC_SESSION_UNAVAILABLE',
            matchingTrainCount:0,providerCalls:selected==='automatic-generation'?0:1,authorityReads:selected==='automatic-generation'?1:2};
        expect(parseSubwayObservationDiagnostic(value,selected)).toMatchObject({matchingTrainCount:0});
        expect(()=>parseSubwayObservationDiagnostic({...value,matchingTrainCount:1},selected)).toThrow();
        expect(()=>parseSubwayObservationDiagnostic({...value,navigationReady:true},selected)).toThrow();
    });

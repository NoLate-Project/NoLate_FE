import { savedJourneyEntryIssue } from '../src/modules/journey/savedJourneyEntry';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
const { readFileSync } = require('fs');

const point = { latitude: 37.5, longitude: 127 };
const input = { source: 'api', provider: 'tmap', plausibility: 'normal', serviceState: 'operating', origin: point, destination: point,
    legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ index, kind, exact: true, geometryInputComplete: true,
        geometrySource: kind === 'WALK' ? 'WALK_STEPS_LINESTRING' : 'TRANSIT_PASS_SHAPE_LINESTRING', coordinates: [point, point], start: point, end: point })) } as JourneyRouteInput;
it('only passes preflight; server/native still validate lengths, continuity, mapping and vehicle admission', () => {
    expect(savedJourneyEntryIssue(input)).toBeNull();
});
it('explains a missing route', () => expect(savedJourneyEntryIssue(null)).toContain('저장된'));
it('never treats preview route selection as an authoritative saved route update', () => {
    const source = readFileSync('src/routeSupport/schedule/useScheduleDetailController.tsx', 'utf8');
    const effect = source.slice(source.indexOf('const item ='), source.indexOf('const canManageSchedule'));
    expect(effect).toContain('if (!item || currentMemberId == null || internalPreviewItem) return;');
    expect(effect).toContain('revalidateAutomaticJourneySavedRoute(String(item.id), input)');
    expect(effect).toContain('[item, currentMemberId, internalPreviewItem]');
});
it.each([[], [input.legs[0]], [...input.legs, input.legs[1]], input.legs.map(leg => ({ ...leg, kind: leg.index === 1 ? 'SUBWAY' : leg.kind }))].map(legs => ({ legs })))('blocks unsupported topology', ({ legs }) => {
    expect(savedJourneyEntryIssue({ ...input, legs } as JourneyRouteInput)).toContain('지하철 탑승');
});
it('allows multiple alternating bus legs only as preflight, not boarding authority',()=>{
    const legs=['WALK','BUS','WALK','BUS','WALK'].map((kind,index)=>({...input.legs[kind==='BUS'?1:0],kind,index}));
    expect(savedJourneyEntryIssue({...input,legs} as JourneyRouteInput)).toBeNull();
});
it('admits an ODsay single subway leg with unknown service only to official recheck',()=>{
    const legs=input.legs.map(leg=>leg.index===1?{...leg,kind:'SUBWAY' as const}:leg);
    const trial={...input,provider:'odsay' as const,serviceState:'UNKNOWN' as const,legs};
    expect(savedJourneyEntryIssue(trial)).toContain('지하철 탑승');
    expect(savedJourneyEntryIssue(trial,true)).toBeNull();
    expect(savedJourneyEntryIssue({...trial,provider:'tmap'},true)).toContain('공급자');
    expect(savedJourneyEntryIssue({...trial,serviceState:'not_operating' as const},true)).toContain('공급자');
});
it.each([{ origin: null }, { destination: { ...point, latitude: 91 } }, { destination: { ...point, longitude: NaN } }])('blocks invalid endpoints', patch => {
    expect(savedJourneyEntryIssue({ ...input, ...patch })).toContain('좌표');
});
it.each([{ source: 'fallback' }, { provider: 'UNKNOWN' }, { plausibility: 'geometry_suspected' }, { serviceState: 'not_operating' }])('blocks unverifiable metadata', patch => {
    expect(savedJourneyEntryIssue({ ...input, ...patch } as JourneyRouteInput)).toContain('공급자');
});
it.each([{ exact: false }, { geometryInputComplete: false }, { coordinates: [] }, { end: null }, { geometrySource: 'DISPLAY_CONNECTOR' },
    { coordinates: [null, point] }])('blocks missing final-walk geometry', patch => {
    expect(savedJourneyEntryIssue({ ...input, legs: input.legs.map(leg => leg.index === 2 ? { ...leg, ...patch } : leg) })).toContain('이동 경로');
});

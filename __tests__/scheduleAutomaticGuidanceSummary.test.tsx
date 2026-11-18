import React from 'react';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {ScheduleDetailRouteQuickSummary} from '../src/routeSupport/schedule/ScheduleDetailRouteQuickSummary';
import {ScheduleGuidanceEndedDetail} from '../src/routeSupport/schedule/ScheduleGuidanceEndedDetail';
import type {ScheduleDetailPresentation} from '../src/routeSupport/schedule/scheduleDetailPresentationModel';
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('../src/routeSupport/schedule/ScheduleDetailChrome',()=>({APP_ACCENT_BLUE:'#1264C7',
    IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT:196,SHEET_HANDLE_HEIGHT:20,Ionicons:'Icon',CompactRouteProgressStrip:'StaticStrip'}));
jest.mock('../src/routeSupport/schedule/schedule-detail.styles',()=>({createScheduleDetailStyles:()=>({})}));
function GuidanceSummary() { return null; }
const completeDeparture=jest.fn(),snapSheet=jest.fn();
const presentation={item:{id:'42'},sheetMode:'compact',routeIdentityTitle:'출발 → 도착',showRouteIdentityInSheet:true,
    departureTimeLabel:'권장 출발',recommendedDepartureTimeLabel:'08:00',routeArrivalSummary:'09:00 도착',routeFactLabels:[],routeProgressSegments:[],
    completeDeparture,snapSheet,hasDepartureInfo:true,departureCompleted:false,journeyGuidanceAvailable:true} as unknown as ScheduleDetailPresentation;
beforeEach(()=>jest.clearAllMocks());
it('active GPS replaces departure hero so current stage/bar fits the compact viewport',()=>{
    let view!:ReactTestRenderer;
    act(()=>{view=TestRenderer.create(<ScheduleDetailRouteQuickSummary presentation={presentation}
        automaticGuidanceActive automaticRouteSummary={<GuidanceSummary />}/>);});
    const json=JSON.stringify(view.toJSON());
    expect(json).not.toContain('권장 출발');expect(json).not.toContain('길안내 시작');
    expect(view.root.findByType(GuidanceSummary)).toBeDefined();
    act(()=>view.root.findAll(node=>node.props.accessibilityLabel==='일정 상세 시트 펼치기, 출발 → 도착')[0].props.onPress());
    expect(snapSheet).toHaveBeenCalledWith('expanded');expect(completeDeparture).not.toHaveBeenCalled();
    act(()=>view.unmount());
});
it('preparation alone or terminal binding does not fabricate active guidance or remove schedule summary',()=>{
    let view!:ReactTestRenderer;
    act(()=>{view=TestRenderer.create(<ScheduleDetailRouteQuickSummary presentation={presentation}/>);});
    expect(JSON.stringify(view.toJSON())).toContain('권장 출발');
    expect(view.root.findAllByType(GuidanceSummary)).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).not.toContain('길안내 시작');
    act(()=>view.unmount());
});

it('keeps boarding and alighting places readable in the ended guidance route', () => {
    const route = {
        ...presentation,
        insets: { top: 0, bottom: 0 },
        routeOption: {
            transitLegs: [
                { kind: 'WALK' },
                { kind: 'BUS', startName: '검토 정류장 A', endName: '검토 정류장 C' },
                { kind: 'WALK' },
            ],
        },
        routeDetailInfo: {
            steps: [
                { id: 'leg-0', type: 'WALK', title: '도보', durationMinutes: 2 },
                { id: 'leg-1', type: 'BUS', title: '버스', badgeText: '361', alightingName: '검토 정류장 C', durationMinutes: 3 },
                { id: 'leg-2', type: 'WALK', title: '도보', durationMinutes: 2 },
            ],
        },
        displayOrigin: { name: '출발지' },
        displayDestination: { name: '도착지' },
        goBack: jest.fn(),
    } as unknown as ScheduleDetailPresentation;
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleGuidanceEndedDetail presentation={route} />); });
    act(() => view.root.findByProps({ testID: 'schedule-guidance-ended-route-button' }).props.onPress());
    const first = view.root.findByProps({ testID: 'schedule-guidance-ended-leg-0' });
    const bus = view.root.findByProps({ testID: 'schedule-guidance-ended-leg-1' });
    const last = view.root.findByProps({ testID: 'schedule-guidance-ended-leg-2' });
    expect(first.findAllByProps({ children: '출발지 → 검토 정류장 A' }).length).toBeGreaterThan(0);
    expect(bus.findAllByProps({ children: '361번' }).length).toBeGreaterThan(0);
    expect(bus.findAllByProps({ children: '검토 정류장 A → 검토 정류장 C' }).length).toBeGreaterThan(0);
    expect(last.findAllByProps({ children: '검토 정류장 C → 도착지' }).length).toBeGreaterThan(0);
    act(() => view.unmount());
});

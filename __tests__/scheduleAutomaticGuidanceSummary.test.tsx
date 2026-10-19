import React from 'react';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {ScheduleDetailRouteQuickSummary} from '../src/routeSupport/schedule/ScheduleDetailRouteQuickSummary';
import type {ScheduleDetailPresentation} from '../src/routeSupport/schedule/scheduleDetailPresentationModel';
import type {JourneyRouteInput} from '../src/modules/journey/journeyRouteInput';
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('../src/routeSupport/schedule/ScheduleDetailChrome',()=>({APP_ACCENT_BLUE:'#1264C7',
    IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT:196,SHEET_HANDLE_HEIGHT:20,Ionicons:'Icon',CompactRouteProgressStrip:'StaticStrip'}));
jest.mock('../src/routeSupport/schedule/schedule-detail.styles',()=>({createScheduleDetailStyles:()=>({})}));
jest.mock('../src/modules/journey/SavedJourneyGuidanceCard',()=>({SavedJourneyGuidanceCard:'GuidanceCard'}));
const completeDeparture=jest.fn(),snapSheet=jest.fn();
const presentation={item:{id:'42'},sheetMode:'compact',routeIdentityTitle:'출발 → 도착',
    recommendedDepartureTimeLabel:'08:00',routeArrivalSummary:'09:00 도착',routeFactLabels:[],routeProgressSegments:[],
    completeDeparture,snapSheet,hasDepartureInfo:true,departureCompleted:false,journeyGuidanceAvailable:true} as unknown as ScheduleDetailPresentation;
const input={legs:[]} as unknown as JourneyRouteInput;
beforeEach(()=>jest.clearAllMocks());
it('active GPS replaces departure hero so current stage/bar fits the compact viewport',()=>{
    let view!:ReactTestRenderer;
    act(()=>{view=TestRenderer.create(<ScheduleDetailRouteQuickSummary presentation={presentation}
        automaticGuidanceActive automaticGuidancePrepared automaticRouteInput={input}/>);});
    const json=JSON.stringify(view.toJSON());
    expect(json).not.toContain('권장 출발');expect(json).not.toContain('길안내 시작');
    expect(view.root.findByType('GuidanceCard' as never).props).toMatchObject({input,scheduleId:'42',compact:true});
    act(()=>view.root.findAll(node=>node.props.accessibilityLabel==='일정 상세 시트 펼치기, 출발 → 도착')[0].props.onPress());
    expect(snapSheet).toHaveBeenCalledWith('expanded');expect(completeDeparture).not.toHaveBeenCalled();
    act(()=>view.unmount());
});
it('preparation alone or terminal binding does not fabricate active guidance or remove schedule summary',()=>{
    let view!:ReactTestRenderer;
    act(()=>{view=TestRenderer.create(<ScheduleDetailRouteQuickSummary presentation={presentation} automaticGuidancePrepared/>);});
    expect(JSON.stringify(view.toJSON())).toContain('권장 출발');
    expect(view.root.findAllByType('GuidanceCard' as never)).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).not.toContain('길안내 시작');
    act(()=>view.unmount());
});

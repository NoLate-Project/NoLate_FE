import React from 'react';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {JourneyWalkingSnapshotTrial} from '../src/modules/journey/JourneyWalkingSnapshotTrial';
jest.mock('../src/modules/journey/serverWalkingSnapshot',()=>({walkingSnapshotTrialCases:['issue','current','replace','cancel','revision','logout','expire'],loadWalkingSnapshotTrial:jest.fn()}));
import {loadWalkingSnapshotTrial} from '../src/modules/journey/serverWalkingSnapshot';
let screen:ReactTestRenderer;
afterEach(()=>{act(()=>screen?.unmount());jest.clearAllMocks();});
test('explicit save/read only and previous geometry summary disappears on pending error',async()=>{
    const run=loadWalkingSnapshotTrial as jest.Mock;
    run.mockResolvedValueOnce({status:'STORED',reason:'SAVED',walkCount:2,pointCount:6});
    await act(async()=>{screen=TestRenderer.create(<JourneyWalkingSnapshotTrial/>);});
    expect(run).not.toHaveBeenCalled();
    await act(async()=>{screen.root.findByProps({testID:'walking-snapshot-issue'}).props.onPress();});
    expect(JSON.stringify(screen.toJSON())).toContain('저장 경로 수신');
    let reject!:(e:Error)=>void;run.mockImplementationOnce(()=>new Promise((_,no)=>{reject=no;}));
    await act(async()=>{screen.root.findByProps({testID:'walking-snapshot-current'}).props.onPress();});
    await act(async()=>{screen.root.findByProps({testID:'walking-snapshot-issue'}).props.onPress();});
    expect(run).toHaveBeenCalledTimes(2);expect(screen.root.findAllByProps({testID:'walking-snapshot-counts'})).toHaveLength(0);
    await act(async()=>{reject(new Error('private-response'));});
    expect(JSON.stringify(screen.toJSON())).toContain('서버 저장 검사 불가');
    expect(JSON.stringify(screen.toJSON())).not.toContain('private-response');
    expect(JSON.stringify(screen.toJSON())).toContain('자동 길안내 OFF');
});
test('blocked result contains no usable path',async()=>{
    (loadWalkingSnapshotTrial as jest.Mock).mockResolvedValue({status:'BLOCKED',reason:'EXPIRED',walkCount:0,pointCount:0});
    await act(async()=>{screen=TestRenderer.create(<JourneyWalkingSnapshotTrial/>);});
    await act(async()=>{screen.root.findByProps({testID:'walking-snapshot-expire'}).props.onPress();});
    expect(JSON.stringify(screen.toJSON())).toContain('저장 경로 차단');
});

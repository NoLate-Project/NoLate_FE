import React from 'react';
import {AppState} from 'react-native';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {OfflineMixedActivityControls,useOfflineMixedActivityTrial} from '../src/modules/journey/OfflineMixedActivityControls';
import type {JourneyRouteInput} from '../src/modules/journey/journeyRouteInput';

const mockCreate=jest.fn();
jest.mock('../src/modules/journey/offlineMixedActivityTrial',()=>({createOfflineMixedActivityTrial:(...args:unknown[])=>mockCreate(...args)}));
jest.mock('../src/modules/journey/automaticJourney',()=>({getAutomaticJourneySnapshot:jest.fn()}));
jest.mock('../src/modules/journey/automaticJourneyTrial',()=>({getAutomaticJourneyTrialBinding:jest.fn()}));
const context={offlineActivityFixture:true},input={} as JourneyRouteInput,source=jest.fn();
let view:ReactTestRenderer|undefined;
let trial:{stop:jest.Mock;tick:jest.Mock;state:jest.Mock};
const initialAppState=AppState.currentState;
function Harness({value=context,route=input}:{value?:unknown;route?:JourneyRouteInput|null}){
    return <OfflineMixedActivityControls trial={useOfflineMixedActivityTrial(value,route,source)}/>;
}
async function render(){await act(async()=>{view=TestRenderer.create(<Harness/>);});}
async function start(){await act(async()=>{view!.root.findByProps({accessibilityLabel:'오프라인 Activity 서버 연결 시험 시작'}).props.onPress();});}
async function advance(ms=1000){await act(async()=>{jest.advanceTimersByTime(ms);});}
beforeEach(()=>{
    jest.useFakeTimers();jest.clearAllMocks();AppState.currentState='active';
    trial={stop:jest.fn(),tick:jest.fn().mockResolvedValue({status:'OFFLINE_ACCEPTED_NOT_APNS',updates:1,ends:0,phase:'WAITING'}),
        state:jest.fn(()=>({status:'WAITING',updates:0,ends:0,phase:'NONE'}))};
    mockCreate.mockReturnValue(trial);
});
afterEach(()=>{act(()=>view?.unmount());view=undefined;AppState.currentState=initialAppState;jest.useRealTimers();});

test('render and elapsed time are inert until the explicit offline start, which is single flight',async()=>{
    await render();await advance(3000);expect(mockCreate).not.toHaveBeenCalled();expect(trial.tick).not.toHaveBeenCalled();
    await start();await start();expect(mockCreate).toHaveBeenCalledTimes(1);expect(trial.tick).not.toHaveBeenCalled();
    await advance();expect(trial.tick).toHaveBeenCalledTimes(1);
    expect(view!.root.findByProps({testID:'offline-activity-state'}).props.children.join('')).toContain('OFFLINE_ACCEPTED_NOT_APNS');
});
test('background and inactive states never sample, foreground return resumes only the existing trial',async()=>{
    await render();await start();AppState.currentState='background';await advance(5000);
    AppState.currentState='inactive';await advance(2000);expect(trial.tick).not.toHaveBeenCalled();
    AppState.currentState='active';await advance();expect(trial.tick).toHaveBeenCalledTimes(1);expect(mockCreate).toHaveBeenCalledTimes(1);
});
test('context replacement stops the old trial and ignores its delayed response',async()=>{
    let done!:(value:unknown)=>void;trial.tick.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
    await render();await start();await advance();
    await act(async()=>{view!.update(<Harness value={{offlineActivityFixture:true}}/>);});
    expect(trial.stop).toHaveBeenCalledTimes(1);
    await act(async()=>done({status:'OLD_RESPONSE',updates:2,ends:0,phase:'RIDING'}));
    expect(view!.root.findByProps({testID:'offline-activity-state'}).props.children.join('')).toContain('OFF');
    expect(JSON.stringify(view!.toJSON())).not.toContain('OLD_RESPONSE');
});
test('unmount stops only the QA sampler and clears its polling timer',async()=>{
    await render();await start();await advance();
    act(()=>view!.unmount());view=undefined;expect(trial.stop).toHaveBeenCalledTimes(1);
    await advance(5000);expect(trial.tick).toHaveBeenCalledTimes(1);
});
test('missing route is inert and factory rejection is redacted with no later sampling',async()=>{
    await act(async()=>{view=TestRenderer.create(<Harness route={null}/>);});await start();expect(mockCreate).not.toHaveBeenCalled();
    await act(async()=>{view!.update(<Harness/>);});mockCreate.mockImplementationOnce(()=>{throw new Error('PRIVATE');});
    await start();await advance();expect(trial.tick).not.toHaveBeenCalled();
    expect(JSON.stringify(view!.toJSON())).toContain('BLOCKED');expect(JSON.stringify(view!.toJSON())).not.toContain('PRIVATE');
});

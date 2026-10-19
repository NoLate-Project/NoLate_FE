import React,{useEffect,useRef,useState} from 'react';
import {AppState,Pressable,Text,View} from 'react-native';
import {getAutomaticJourneySnapshot} from './automaticJourney';
import {getAutomaticJourneyTrialBinding} from './automaticJourneyTrial';
import type {JourneyAuthenticationSource} from './automaticJourneyAuthentication';
import type {JourneyRouteInput} from './journeyRouteInput';
import {createOfflineMixedActivityTrial} from './offlineMixedActivityTrial';

/** Test route only, kept mounted when its actual ScheduleDetail child is displayed. */
export function useOfflineMixedActivityTrial(context:unknown,input:JourneyRouteInput|null,source:JourneyAuthenticationSource|null){
    const trial=useRef<ReturnType<typeof createOfflineMixedActivityTrial>|null>(null);
    const [state,setState]=useState({status:'OFF',updates:0,ends:0,phase:'NONE'});
    useEffect(()=>{trial.current?.stop();trial.current=null;setState({status:'OFF',updates:0,ends:0,phase:'NONE'});
        return()=>{trial.current?.stop();trial.current=null;};},[context,input,source]);
    useEffect(()=>{const timer=setInterval(()=>{
        const current=trial.current;if(!current||AppState.currentState!=='active')return;
        current.tick().then(next=>{if(trial.current===current)setState(next);});
    },1000);return()=>clearInterval(timer);},[]);
    return {state,start:()=>{
        if(trial.current||!input||!source)return;
        try{trial.current=createOfflineMixedActivityTrial({context,source,snapshot:getAutomaticJourneySnapshot,
            binding:()=>getAutomaticJourneyTrialBinding(input)});setState(trial.current.state());}
        catch{setState({status:'BLOCKED',updates:0,ends:0,phase:'NONE'});}
    }};
}
export function OfflineMixedActivityControls({trial}:{trial:ReturnType<typeof useOfflineMixedActivityTrial>}){
    return <View style={{gap:8}}>
        <Text>오프라인 Activity 서버 시험 · Firebase/APNs 전송 없음 · GPS/단계는 바꾸지 않습니다. 전경에서만 표본을 전송합니다.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="오프라인 Activity 서버 연결 시험 시작" disabled={trial.state.status!=='OFF'}
            onPress={trial.start} style={{padding:14,borderRadius:12,backgroundColor:'#1264C7'}}>
            <Text style={{color:'white'}}>오프라인 Activity 서버 연결 시험 시작</Text></Pressable>
        <Text testID="offline-activity-state">오프라인 Activity: {trial.state.status} · 요청 시도 UPDATE {trial.state.updates} · END {trial.state.ends} · {trial.state.phase}</Text>
    </View>;
}

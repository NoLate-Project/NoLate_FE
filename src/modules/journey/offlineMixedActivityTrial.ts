import {automaticRecord,normalizeAutomaticJourneyBinding,type AutomaticJourneyBinding,type AutomaticJourneySnapshot} from './automaticJourney';
import {requireJourneyAuthenticationIdentity,type JourneyAuthenticationSource} from './automaticJourneyAuthentication';
import {presentSavedJourneyGuidance} from './savedJourneyGuidance';
import {journeyRouteUTF8Bytes} from './journeyRouteInput';

const origin='http://127.0.0.1:15546';
const fcm='synthetic-offline-installation-not-firebase',token='a'.repeat(64);
type State={status:string;updates:number;ends:number;phase:string};
const contentKeys=new Set(['schemaVersion','sessionId','scheduleId','generation','routeRevision','routeInputDigest','sequence',
    'status','phase','quality','instruction','activeLegIndex','walkProgress','rideProgress','alighting','observedAt','validUntil',
    'boardingConfirmed','arrivalStatus','arrival']);
const nestedKeys:Record<string,Set<string>>={
    arrival:new Set(['busLegIndex','providerRouteId','directionLabel','sourceUpdatedAt','expectedAt','validUntil']),
    alighting:new Set(['kind','remainingMeters']),
};
const scalar=(value:unknown)=>value===null||['string','number','boolean'].includes(typeof value);
function contentSafe(raw:Record<string,unknown>):boolean{
    return Object.entries(raw).every(([key,value])=>contentKeys.has(key)&&(scalar(value)||
        nestedKeys[key]&&automaticRecord(value)&&Object.entries(value as Record<string,unknown>)
            .every(([nested,item])=>nestedKeys[key].has(nested)&&scalar(item))));
}
/** Only the test issuer/loopback endpoint. No Firebase/native push configure, authStorage or real token reads. */
async function send(source:JourneyAuthenticationSource,path:string,body?:Record<string,unknown>):Promise<unknown>{
    if(!__DEV__||(!/^\/api\/schedules\/9001\/automatic-journey\/[a-f0-9-]{36}\/live-activity(?:\/end)?$/.test(path)
        &&path!=='/__fixture/state'))throw new Error('OFFLINE_ACTIVITY_PATH_REQUIRED');
    const auth=await source();requireJourneyAuthenticationIdentity(auth,auth);
    if(auth.apiOrigin!==origin||auth.authMemberId!==7||auth.loginGeneration!==2)throw new Error('OFFLINE_ACTIVITY_IDENTITY_REQUIRED');
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),4000);
    try{
        // QA-only fetch; RN does not guarantee redirect:error. Never use real credentials here
        // or substitute this adapter for the product native authenticated transport.
        const init:RequestInit&{redirect:'error'}={method:body?'POST':'GET',credentials:'omit',redirect:'error',signal:abort.signal,
            headers:{Authorization:`Bearer ${auth.accessToken}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})};
        const response=await fetch(origin+path,init);
        const raw=await response.text();requireJourneyAuthenticationIdentity(await source(),auth);
        if(!response.ok||response.redirected||response.url&&response.url!==origin+path||raw.length>65536)throw new Error('OFFLINE_ACTIVITY_REJECTED');
        return JSON.parse(raw);
    }finally{clearTimeout(timer);}
}
/** Explicit foreground QA sampler, not product APNs transport or a navigation phase controller. */
export function createOfflineMixedActivityTrial(options:{context:unknown;source:JourneyAuthenticationSource;
    snapshot:()=>Promise<AutomaticJourneySnapshot>;binding:()=>AutomaticJourneyBinding|null;
    request?:(path:string,body?:Record<string,unknown>)=>Promise<unknown>;now?:()=>number}){
    const context=automaticRecord(options.context);
    if(!__DEV__||context?.fixtureOnly!==true||context.offlineActivityFixture!==true||context.extendedNavigationFixture!==true
        ||context.syntheticTransferFixture!==true||context.guidancePushRealProvider!==false||context.memberId!==7
        ||context.apiOrigin!==origin)throw new Error('OFFLINE_ACTIVITY_CONTEXT_REQUIRED');
    const now=options.now??(()=>Date.now()/1000),startedAt=now(),request=options.request??((path,body)=>send(options.source,path,body));
    let state:State={status:'WAITING',updates:0,ends:0,phase:'NONE'},busy=false,stopped=false;
    let captured:AutomaticJourneyBinding|null=null,lastTimestamp=-1,lastSequence=-1,endAttempted=false;
    const view=()=>({...state});
    const stop=()=>{stopped=true;state={...state,status:'STOPPED'};};
    async function tick():Promise<State>{
        if(stopped||busy)return view();busy=true;
        try{
            const at=now();if(at<startedAt||at>=startedAt+1200)throw new Error();
            if(endAttempted){
                const result=automaticRecord(await request('/__fixture/state'));
                if(stopped)return view();
                if(result?.offlineActivityFixture!==true||result.guidancePushRealProvider!==false)throw new Error();
                if(result.offlineActivityEndState==='ACCEPTED'){state={...state,status:'END_ACCEPTED'};stopped=true;}
                else if(['UNKNOWN','REJECTED','BLOCKED'].includes(String(result.offlineActivityEndState)))throw new Error();
                return view();
            }
            const snapshot=await options.snapshot();if(stopped)return view();
            const selected=normalizeAutomaticJourneyBinding(options.binding());
            if(!captured){
                if(!selected||!['ARMED','ACTIVE'].includes(snapshot.status))return view();
                if(selected.apiOrigin!==origin||selected.authMemberId!==7||selected.loginGeneration!==2
                    ||selected.scheduleId!=='9001'||selected.syncScope!=='AUTHENTICATED')throw new Error();
                captured=selected;
            }
            if(snapshot.sessionId!==captured.sessionId||snapshot.routeRevision!==captured.routeRevision)throw new Error();
            const path=`/api/schedules/9001/automatic-journey/${captured.sessionId}/live-activity`;
            const binding={generation:captured.generation,routeRevision:captured.routeRevision,clientOwnerId:captured.clientOwnerId,
                routeInputDigest:captured.routeInputDigest};
            if(['STOPPED','EXPIRED'].includes(snapshot.status)){
                if(!state.updates){state={...state,status:'NO_ACTIVITY'};stopped=true;return view();}
                endAttempted=true;state={...state,ends:1};
                const reply=automaticRecord(await request(path+'/end',binding)),data=automaticRecord(reply?.data);
                if(stopped)return view();
                if(reply?.success!==true||data?.sessionId!==captured.sessionId||data.endQueued!==true||data.deviceVerified!==false)throw new Error();
                state={...state,status:'END_QUEUED'};return view();
            }
            if(!selected||JSON.stringify(selected)!==JSON.stringify(captured))throw new Error();
            if(snapshot.status!=='ACTIVE'||snapshot.departureAcknowledged!==true)return view();
            const raw=automaticRecord(snapshot.guidance),guidance=presentSavedJourneyGuidance(snapshot,captured,at);
            if(!raw||!guidance?.fresh||raw.sequence===lastSequence||Math.floor(at)<lastTimestamp+15)return view();
            if(!contentSafe(raw)||journeyRouteUTF8Bytes(JSON.stringify(raw))>3200)throw new Error();
            if(state.updates>=80)throw new Error();
            lastTimestamp=Math.floor(at);lastSequence=raw.sequence as number;
            state={...state,updates:state.updates+1,status:'SENDING'};
            const reply=automaticRecord(await request(path,{...binding,activityId:captured.sessionId,fcmRegistrationToken:fcm,
                liveActivityToken:token,timestamp:lastTimestamp,contentState:raw})),data=automaticRecord(reply?.data);
            if(stopped)return view();
            if(reply?.success!==true||data?.sessionId!==captured.sessionId||data.timestamp!==lastTimestamp
                ||data.providerAccepted!==true||data.deviceVerified!==false)throw new Error();
            state={...state,status:'OFFLINE_ACCEPTED_NOT_APNS',phase:guidance.phase};
        }catch{if(!stopped){state={...state,status:'BLOCKED'};stopped=true;}}
        finally{busy=false;}
        return view();
    }
    return {tick,stop,state:view};
}

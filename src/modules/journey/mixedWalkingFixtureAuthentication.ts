import {createRenewingJourneyAuthenticationSource,journeyAuthentication,requireJourneyAuthenticationIdentity,type JourneyAuthenticationSource} from './automaticJourneyAuthentication';
import {automaticRecord} from './automaticJourney';
import {journeyJSONRequest} from './journeyJSONRequest';

const origin='http://127.0.0.1:15546';
/** Explicit bounded server mode only; a true provider flag by itself never enables real delivery. */
export function isMixedWalkingRealActivityContext(value:unknown):boolean {
    const c=automaticRecord(value);
    const supportedRoute=(c?.syntheticSubwayFixture===true&&c.syntheticTransferFixture===false&&c.extendedNavigationFixture===false)
        ||(c?.syntheticSubwayFixture===false&&c.syntheticTransferFixture===true&&c.extendedNavigationFixture===true);
    return __DEV__&&c?.fixtureOnly===true&&c.memberId===7&&c.apiOrigin===origin
        &&c.guidancePushRealProvider===true&&c.realActivityFixture===true&&supportedRoute
        &&c.officialLiveSubwayFixture!==true&&c.offlineActivityFixture===false
        &&typeof c.allowedInstallationDigest==='string'&&/^[a-f0-9]{64}$/.test(c.allowedInstallationDigest);
}
/** Test issuer only. No authStorage, refresh endpoint, provider keys, or production origin. */
export function createMixedWalkingFixtureAuthentication(initial:unknown,
    readContext:()=>Promise<unknown>=()=>journeyJSONRequest(origin+'/__fixture/context')):JourneyAuthenticationSource {
    function parse(value:unknown){
        const context=automaticRecord(value);
        const officialSubway=context?.officialLiveSubwayFixture===true
            &&context.syntheticSubwayFixture===false&&context.syntheticTransferFixture===false
            &&context.guidancePushRealProvider===false&&context.realActivityFixture!==true
            &&context.offlineActivityFixture!==true;
        if(!__DEV__||context?.fixtureOnly!==true||context.memberId!==7||context.apiOrigin!==origin
            ||!(context.guidancePushRealProvider===false||isMixedWalkingRealActivityContext(context))
            ||(!officialSubway&&context.officialLiveSubwayFixture===true)
            ||(context.syntheticTransferFixture!==true&&context.syntheticSubwayFixture!==true&&!officialSubway)
            ||context.routeRevision!==1||typeof context.routeFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(context.routeFingerprint))
            throw new Error('MIXED_FIXTURE_CONTEXT_REQUIRED');
        return {auth:journeyAuthentication(context.accessToken,origin,7),fingerprint:context.routeFingerprint,
            remote:isMixedWalkingRealActivityContext(context),digest:context.guidancePushRealProvider===true?context.allowedInstallationDigest:null,
            mode:officialSubway?'OFFICIAL_SUBWAY':context.syntheticSubwayFixture===true?'SYNTHETIC_SUBWAY':'SYNTHETIC_TRANSFER'};
    }
    const first=parse(initial);let current=first.auth;
    return createRenewingJourneyAuthenticationSource(async()=>current,async previous=>{
        const next=parse(await readContext());
        requireJourneyAuthenticationIdentity(next.auth,previous);
        if(next.fingerprint!==first.fingerprint)throw new Error('MIXED_FIXTURE_ROUTE_CHANGED');
        if(next.remote!==first.remote||next.digest!==first.digest||next.mode!==first.mode)
            throw new Error('MIXED_FIXTURE_DELIVERY_CHANGED');
        current=next.auth;
    });
}

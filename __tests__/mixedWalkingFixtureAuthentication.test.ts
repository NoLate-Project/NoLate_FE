import {createMixedWalkingFixtureAuthentication,isMixedWalkingRealActivityContext} from '../src/modules/journey/mixedWalkingFixtureAuthentication';
import {Buffer} from 'buffer';
jest.mock('../src/modules/journey/journeyJSONRequest',()=>({journeyJSONRequest:jest.fn(()=>{throw Error('NO_NETWORK');})}));
const base={fixtureOnly:true,memberId:7,apiOrigin:'http://127.0.0.1:15546',guidancePushRealProvider:false,
    syntheticTransferFixture:true,routeRevision:1,routeFingerprint:'a'.repeat(64)};
const token=(exp:number,sg=2)=>['e30',Buffer.from(JSON.stringify({type:'ACCESS',sub:'7',sg,iat:900,exp})).toString('base64url'),'e30'].join('.');
const remote={...base,guidancePushRealProvider:true,realActivityFixture:true,syntheticTransferFixture:false,
    syntheticSubwayFixture:true,offlineActivityFixture:false,extendedNavigationFixture:false,allowedInstallationDigest:'b'.repeat(64)};
beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(1000_000);});
afterEach(()=>jest.useRealTimers());
it('admits only the explicit single-installation subway real Activity mode and fences changes on renewal',async()=>{
    expect(isMixedWalkingRealActivityContext(remote)).toBe(true);
    for(const patch of [{allowedInstallationDigest:'bad'},{realActivityFixture:false},{syntheticTransferFixture:true},
        {offlineActivityFixture:true},{extendedNavigationFixture:true},{apiOrigin:'https://example.invalid'}]){
        expect(isMixedWalkingRealActivityContext({...remote,...patch})).toBe(false);
        expect(()=>createMixedWalkingFixtureAuthentication({...remote,...patch,accessToken:token(1100)})).toThrow();
    }
    const source=createMixedWalkingFixtureAuthentication({...remote,accessToken:token(1010)},async()=>({...remote,
        allowedInstallationDigest:'c'.repeat(64),accessToken:token(1700)}));
    await expect(source()).rejects.toThrow('MIXED_FIXTURE_DELIVERY_CHANGED');
});
it('admits only the isolated extended five-leg real Activity mode',async()=>{
    const transfer={...remote,syntheticSubwayFixture:false,syntheticTransferFixture:true,extendedNavigationFixture:true};
    expect(isMixedWalkingRealActivityContext(transfer)).toBe(true);
    expect((await createMixedWalkingFixtureAuthentication({...transfer,accessToken:token(1100)})()).expiresAtEpochSeconds).toBe(1100);
    for(const patch of [{extendedNavigationFixture:false},{syntheticSubwayFixture:true},
        {offlineActivityFixture:true},{officialLiveSubwayFixture:true},{allowedInstallationDigest:'bad'}]){
        expect(isMixedWalkingRealActivityContext({...transfer,...patch})).toBe(false);
    }
});
it('renews only near expiry using a single fixed-identity flight, without ending the location trial',async()=>{
    const read=jest.fn().mockResolvedValue({...base,accessToken:token(1700)});
    const source=createMixedWalkingFixtureAuthentication({...base,accessToken:token(1100)},read);
    expect((await source()).expiresAtEpochSeconds).toBe(1100);expect(read).not.toHaveBeenCalled();
    jest.setSystemTime(1080_000);
    const values=await Promise.all([source(),source(),source()]);
    expect(read).toHaveBeenCalledTimes(1);expect(values.every(v=>v.expiresAtEpochSeconds===1700&&v.loginGeneration===2)).toBe(true);
});
it('admits the isolated official subway feed without enabling APNs or synthetic train data',async()=>{
    const official={...base,syntheticTransferFixture:false,syntheticSubwayFixture:false,
        officialLiveSubwayFixture:true,realActivityFixture:false,offlineActivityFixture:false};
    const source=createMixedWalkingFixtureAuthentication({...official,accessToken:token(1100)});
    expect((await source()).expiresAtEpochSeconds).toBe(1100);
    for(const patch of [{guidancePushRealProvider:true},{syntheticSubwayFixture:true},
        {syntheticTransferFixture:true},{realActivityFixture:true},{offlineActivityFixture:true}]){
        expect(()=>createMixedWalkingFixtureAuthentication({...official,...patch,accessToken:token(1100)})).toThrow();
    }
    const renew=createMixedWalkingFixtureAuthentication({...official,accessToken:token(1010)},
        async()=>({...official,officialLiveSubwayFixture:false,syntheticSubwayFixture:true,accessToken:token(1700)}));
    await expect(renew()).rejects.toThrow('MIXED_FIXTURE_DELIVERY_CHANGED');
});
it.each([{memberId:8},{apiOrigin:'https://example.invalid'},{guidancePushRealProvider:true},{fixtureOnly:false},
    {syntheticTransferFixture:false},{routeRevision:2},{routeFingerprint:'bad'}])('rejects foreign fixture context %j',patch=>{
    expect(()=>createMixedWalkingFixtureAuthentication({...base,accessToken:token(1100),...patch})).toThrow();
});
it.each([{accessToken:token(1700,3)},{routeFingerprint:'b'.repeat(64)}])('never renews across login or route identity (case %#)',async patch=>{
    const source=createMixedWalkingFixtureAuthentication({...base,accessToken:token(1010)},async()=>({...base,accessToken:token(1700),...patch}));
    await expect(source()).rejects.toThrow();
});

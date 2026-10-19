import { journeyReadinessReport } from '../src/modules/journey/journeyReadiness';
import { normalizeAutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import { normalizeJourneyDiagnostics } from '../src/modules/journey/journeyDiagnostics';

const report = (patch = {}, probe = {}, sync = {}) => journeyReadinessReport(normalizeAutomaticJourneySnapshot({ enabled: true, status: 'ACTIVE', ...patch }),
    { status: 'IDLE', paused: false, errorCode: null, ...sync }, normalizeJourneyDiagnostics(probe), 1020);
it('never upgrades a token, idle queue, probe or output mute into completed validation', () => {
    const checks = report({ guidancePushTokenAvailable: true }, { enabled: true, speech: { outputMuted: true }, liveActivity: { activitiesEnabled: true } });
    for (const code of ['STOP_SYNC', 'APNS', 'VOICE_SILENT', 'PRODUCTION_ROUTE']) expect(checks.find(check => check.code === code)?.state).toBe('UNVERIFIED');
    expect(checks.find(check => check.code === 'TRANSIT_RIDE')?.state).toBe('PARTIAL');
    for (const code of ['SUBWAY_NAVIGATION', 'DEVICE_RELEASE']) expect(checks.find(check => check.code === code)?.state).toBe('UNSUPPORTED');
});
it.each(['IDLE', 'ARMED', 'ACTIVE', 'STOPPED'])('keeps implementation scope separate from %s and synthetic success claims', status => {
    const checks = report({ status, enabled: true, departureAcknowledged: true, guidancePushProviderAcceptedCount: 100,
        guidance: { observedAt: 1019, validUntil: 1035, navigationReady: true, passengerBoardingConfirmed: true } });
    expect(checks.find(check => check.code === 'TRANSIT_RIDE')).toMatchObject({ state: 'PARTIAL', detail: expect.stringContaining('합성 GPS/차량') });
    expect(checks.find(check => check.code === 'SUBWAY_NAVIGATION')).toMatchObject({ state: 'UNSUPPORTED', detail: expect.stringContaining('native 승객 결합 미연결') });
    expect(checks.find(check => check.code === 'DEVICE_RELEASE')).toMatchObject({ state: 'UNSUPPORTED', detail: expect.stringContaining('Debug 시뮬레이터 전용') });
    expect(checks.find(check => check.code === 'APNS')?.state).toBe('UNVERIFIED');
    expect(checks.find(check => check.code === 'PRODUCTION_ROUTE')?.state).toBe('UNVERIFIED');
});
it.each([{}, { observedAt: 1021, validUntil: 1035 }, { observedAt: 1000, validUntil: 1020 }, { observedAt: NaN }])('stale/missing/future guidance needs attention %j', guidance => {
    expect(report({ guidance }).find(check => check.code === 'GUIDANCE_FRESHNESS')?.state).toBe('ATTENTION');
});
it('shows fresh guidance separately from permission and OS precision', () => {
    const checks = report({ authorization: 'DENIED', guidance: { observedAt: 1019, validUntil: 1035 } }, { enabled: true, location: { accuracyAuthorization: 'REDUCED' } }, { pendingStopCount: 1 });
    expect(checks.filter(check => check.state === 'ATTENTION').map(check => check.code)).toEqual(['LOCATION_AUTH', 'LOCATION_PRECISION', 'STOP_SYNC', 'LIVE_ACTIVITY']);
    expect(checks.find(check => check.code === 'GUIDANCE_FRESHNESS')?.detail).toContain('1초 전');
});
it('redacts arbitrary labels, identifiers, coordinates, tokens, errors and route metadata', () => {
    const secret = 'PRIVATE_TOKEN_OR_LOCATION';
    const serialized = JSON.stringify(report({ authorization: secret, sessionId: secret, lastErrorCode: secret,
        guidance: { latitude: 37.1, routeInputDigest: secret }, guidanceRoute: { name: secret } },
    { iosVersion: secret, location: { state: secret, lastErrorCode: secret }, speech: { lastErrorCode: secret } }, { errorCode: secret }));
    expect(serialized).not.toContain(secret); expect(serialized).not.toContain('37.1');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { assessJourneyFixtureState } from './journey-readiness-check.mjs';
const fixture = { fixtureOnly: true, lastState: 'STOPPED', prepareCount: 1, departureCount: 1, activationCount: 1, cancelCount: 1,
    authenticatedRequests: 2, rejectedRequests: 0, validationRequests: 0, arrivalRequests: 0, refreshRequests: 0,
    guidancePushAcceptedCount: 0, trapRequests: 0, trapAuthorizationSeen: false, guidancePushRealProvider: false };
test('stopped fixture is observed but never proves actual APNs or production navigation', () => {
    const report = assessJourneyFixtureState(fixture, true);
    assert.equal(report.verdict, 'OBSERVED_EXPECTATION_MET'); assert.equal(report.apnsDelivery, 'UNVERIFIED');
});
test('unknown/incomplete counters, nonterminal state or trap require attention', () => {
    for (const patch of [{ trapRequests: 1 }, { trapAuthorizationSeen: true }, { activationCount: -1 },
        { activationCount: undefined }, { activationCount: NaN }, { lastState: 'ACTIVE' }, { lastState: 'foreign' }]) {
        assert.equal(assessJourneyFixtureState({ ...fixture, ...patch }, true).verdict, 'ATTENTION');
    }
});
test('does not echo injected token/coordinate/account data or arbitrary states', () => {
    const report = JSON.stringify(assessJourneyFixtureState({ ...fixture, token: 'secret', latitude: 37.4, memberId: 7, lastState: 'private' }));
    assert.doesNotMatch(report, /secret|37\.4|memberId|private/);
    assert.throws(() => assessJourneyFixtureState({ ...fixture, fixtureOnly: false }));
});

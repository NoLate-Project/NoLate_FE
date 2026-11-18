import { normalizeAutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import { isSameGuidanceActivityLink, resolveGuidanceActivityHandoff } from '../src/modules/journey/useGuidanceActivityHandoff';

jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({
    getAutomaticJourneySyncState: () => ({}),
    subscribeAutomaticJourneySync: () => () => undefined,
}));

const session = '85f24bfa-d714-4c05-9b6f-e34c969c617a';
const schedule = '58';
const member = 7;

const snapshot = (status: string, extra: Record<string, unknown> = {}) =>
    normalizeAutomaticJourneySnapshot({
        enabled: true, status, sessionId: session, guidanceMemberId: member,
        guidance: { scheduleId: schedule, phase: 'UNAVAILABLE' }, ...extra,
    });

it.each([['ARMED', 'live'], ['ACTIVE', 'live'], ['STOPPED', 'ended'], ['EXPIRED', 'ended'], ['IDLE', 'schedule']])(
    'opens the correct view for an owned %s activity, regardless of GPS freshness',
    (status, expected) => {
        expect(resolveGuidanceActivityHandoff(snapshot(status), session.toUpperCase(), schedule, member)).toBe(expected);
    },
);

it('opens the ordinary schedule when a stale link has no proof for this exact activity and account', () => {
    const ended = snapshot('STOPPED');
    expect(resolveGuidanceActivityHandoff(ended, undefined, schedule, member)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(ended, 'missing', schedule, member)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(ended, session, '59', member)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(ended, session, schedule, member + 1)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(ended, session, schedule, null)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(snapshot('STOPPED', { guidance: null }), session, schedule, member)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(null, session, schedule, member)).toBe('schedule');
});

it('opens the existing consent flow only for a matching, unexpired checkpoint after process death', () => {
    const idle = snapshot('IDLE', { sessionId: null, guidance: null, checkpointAvailable: true });
    const checkpoint = { scheduleId: schedule, memberId: member, sessionId: session, expiresAt: Date.now() / 1000 + 60 };
    expect(resolveGuidanceActivityHandoff(idle, session.toUpperCase(), schedule, member, checkpoint)).toBe('resume');
    expect(resolveGuidanceActivityHandoff(idle, session, schedule, member)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(idle, session, schedule, member + 1, checkpoint)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(idle, session, '59', member, checkpoint)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(idle, '11111111-1111-4111-8111-111111111111', schedule, member, checkpoint)).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(idle, session, schedule, member, { ...checkpoint, expiresAt: 0 })).toBe('schedule');
    expect(resolveGuidanceActivityHandoff(snapshot('IDLE'), session, schedule, member, checkpoint)).toBe('schedule');
});

it('reopens the mounted sheet only for the same Activity link', () => {
    const url = `nolate://schedule/${schedule}?entrySource=guidance-activity&guidanceSession=${session.toUpperCase()}`;
    expect(isSameGuidanceActivityLink(url, schedule, session)).toBe(true);
    expect(isSameGuidanceActivityLink(url, '59', session)).toBe(false);
    expect(isSameGuidanceActivityLink(url, schedule, '11111111-1111-4111-8111-111111111111')).toBe(false);
    expect(isSameGuidanceActivityLink(`${url}&openRouteDetail=1`, schedule, session)).toBe(false);
    expect(isSameGuidanceActivityLink(`nolate://schedule/${schedule}?openRouteDetail=1`, schedule, session)).toBe(false);
});

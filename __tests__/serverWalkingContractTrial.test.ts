import { loadWalkingContractTrial, walkingContractCases, walkingContractSummary } from '../src/modules/journey/serverWalkingContractTrial';
jest.mock('../src/modules/journey/journeyJSONRequest', () => ({ journeyJSONRequest: jest.fn() }));
jest.mock('../src/modules/journey/automaticJourneyAuthentication', () => ({ journeyAuthentication: jest.fn(() => ({ accessToken: 'synthetic-token' })) }));
import { journeyJSONRequest } from '../src/modules/journey/journeyJSONRequest';
import { journeyAuthentication } from '../src/modules/journey/automaticJourneyAuthentication';
const reasons = ['TRANSIT_ADMISSION_PENDING', 'OWNER_CHANGED', 'REVISION_CHANGED', 'SAVED_ROUTE_CHANGED', 'EXPIRED', 'DISCONNECTED_LINES', 'UNSUPPORTED_SAVED_ROUTE',
    'TRANSIT_ADMISSION_PENDING', 'SAVED_ROUTE_CHANGED', 'OWNER_CHANGED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'];
const bound = (id: string) => id === 'complete' || id === 'http-complete';
const calls = (id: string) => ['owner', 'source'].includes(id) ? 0 : ['gap', 'http-redirect', 'http-large', 'http-timeout'].includes(id) ? 1 : 2;
const summary = (selected = 'complete') => ({ fixtureOnly: true, case: selected, navigationReady: false,
    transitProvider: 'odsay', walkProvider: 'tmap', status: bound(selected) ? 'BOUND' : 'BLOCKED',
    reason: reasons[walkingContractCases.indexOf(selected as typeof walkingContractCases[number])],
    walkCount: bound(selected) ? 2 : 0, pointCount: bound(selected) ? 6 : 0, providerCalls: calls(selected),
    ...(selected.startsWith('http-') ? { authorityReads: calls(selected) === 2 ? 2 : 1, redirectTrapCalls: 0 } : {}) });
const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
    globalThis.fetch = fetchMock; fetchMock.mockReset();
    (journeyJSONRequest as jest.Mock).mockResolvedValue({ fixtureOnly: true, apiOrigin: 'http://127.0.0.1:15544',
        memberId: 7, guidancePushRealProvider: false, accessToken: 'test-issuer-only' });
    (journeyAuthentication as jest.Mock).mockClear();
});
afterAll(() => { globalThis.fetch = originalFetch; });
test.each(walkingContractCases)('strict diagnostic summary for %s cannot grant navigation', selected => {
    expect(walkingContractSummary(summary(selected), selected)).toMatchObject({ status: bound(selected) ? 'BOUND' : 'BLOCKED' });
    expect(walkingContractSummary(summary(selected), selected)).not.toHaveProperty('navigationReady');
});
test.each([{ authorityReads: 1 }, { redirectTrapCalls: 1 }])('HTTP trial must attest fresh read counts and no redirect target request', change => {
    expect(() => walkingContractSummary({ ...summary('http-complete'), ...change }, 'http-complete')).toThrow('INVALID_WALKING_CONTRACT_RESPONSE');
});
test.each(['fixtureOnly', 'case', 'navigationReady', 'transitProvider', 'walkProvider', 'status', 'reason', 'walkCount', 'pointCount', 'providerCalls'])(
    'wrong %s rejects instead of showing stale success', key => {
        expect(() => walkingContractSummary({ ...summary(), [key]: 'altered' }, 'complete')).toThrow('INVALID_WALKING_CONTRACT_RESPONSE');
    });
test('loopback only, ephemeral test authentication, omitted cookies, redirect denial and bounded response', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify(summary()) });
    expect(await loadWalkingContractTrial('complete')).toMatchObject({ status: 'BOUND', walkCount: 2 });
    expect(journeyJSONRequest).toHaveBeenCalledWith('http://127.0.0.1:15544/__fixture/context');
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:15544/__fixture/walking-contract?case=complete', expect.objectContaining({
        method: 'GET', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer synthetic-token', Accept: 'application/json' },
    }));
});
test.each([{ fixtureOnly: false }, { apiOrigin: 'https://example.invalid' }, { memberId: 8 }, { guidancePushRealProvider: true }])(
    'bad context never sends credentials elsewhere', async change => {
        (journeyJSONRequest as jest.Mock).mockResolvedValue({ fixtureOnly: true, apiOrigin: 'http://127.0.0.1:15544', memberId: 7,
            guidancePushRealProvider: false, ...change });
        await expect(loadWalkingContractTrial('complete')).rejects.toThrow('WALKING_CONTRACT_UNAVAILABLE');
        expect(fetchMock).not.toHaveBeenCalled(); expect(journeyAuthentication).not.toHaveBeenCalled();
    });
test.each([{ ok: false }, { ok: true, redirected: true }, { ok: true, url: 'http://127.0.0.1:15545/trap' }])(
    'HTTP failure or redirect is not a passing diagnostic', async response => {
        fetchMock.mockResolvedValue(response);
        await expect(loadWalkingContractTrial('complete')).rejects.toThrow('WALKING_CONTRACT_UNAVAILABLE');
    });
test('oversized response and unknown case fail closed', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => ' '.repeat(2049) });
    await expect(loadWalkingContractTrial('complete')).rejects.toThrow('INVALID_WALKING_CONTRACT_RESPONSE');
    fetchMock.mockClear();
    await expect(loadWalkingContractTrial('bad' as 'complete')).rejects.toThrow('WALKING_CONTRACT_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
});

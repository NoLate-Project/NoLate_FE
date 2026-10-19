import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { JourneyServerWalkingTrial } from '../src/modules/journey/JourneyServerWalkingTrial';
jest.mock('../src/modules/journey/serverWalkingContractTrial', () => ({
    walkingContractCases: ['complete', 'owner', 'revision', 'route', 'expired', 'gap', 'source', 'http-complete', 'http-edited',
        'http-revoked', 'http-redirect', 'http-large', 'http-timeout'], loadWalkingContractTrial: jest.fn(),
}));
import { loadWalkingContractTrial } from '../src/modules/journey/serverWalkingContractTrial';
let screen: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => { act(() => screen?.unmount()); });
test('explicit action only, single flight, success replaced by pending and failed response', async () => {
    const run = loadWalkingContractTrial as jest.Mock;
    run.mockResolvedValueOnce({ status: 'BOUND', reason: 'TRANSIT_ADMISSION_PENDING', walkCount: 2, pointCount: 6, providerCalls: 2 });
    await act(async () => { screen = TestRenderer.create(<JourneyServerWalkingTrial />); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { screen.root.findByProps({ testID: 'walking-contract-complete' }).props.onPress(); });
    expect(JSON.stringify(screen.toJSON())).toContain('도보 계약 통과');
    let reject!: () => void;
    run.mockImplementationOnce(() => new Promise((_, failure) => { reject = () => failure(new Error('private body')); }));
    await act(async () => { screen.root.findByProps({ testID: 'walking-contract-gap' }).props.onPress(); });
    await act(async () => { screen.root.findByProps({ testID: 'walking-contract-complete' }).props.onPress(); });
    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(screen.toJSON())).not.toContain('도보 계약 통과');
    await act(async () => { reject(); });
    expect(JSON.stringify(screen.toJSON())).toContain('서버 검사 불가');
    expect(screen.root.findAllByProps({ testID: 'walking-contract-counts' })).toHaveLength(0);
    expect(JSON.stringify(screen.toJSON())).not.toContain('private body');
});
test('HTTP mode is explicit, has separate scenarios, clears previous success and never starts navigation', async () => {
    const run = loadWalkingContractTrial as jest.Mock;
    run.mockResolvedValue({ status: 'BOUND', reason: 'TRANSIT_ADMISSION_PENDING', walkCount: 2, pointCount: 6, providerCalls: 2 });
    await act(async () => { screen = TestRenderer.create(<JourneyServerWalkingTrial />); });
    expect(screen.root.findAllByProps({ testID: 'walking-contract-http-complete' })).toHaveLength(0);
    await act(async () => { screen.root.findByProps({ testID: 'walking-contract-complete' }).props.onPress(); });
    await act(async () => { screen.root.findByProps({ accessibilityLabel: 'HTTP 서버 연결 검사로 전환' }).props.onPress(); });
    expect(JSON.stringify(screen.toJSON())).not.toContain('도보 계약 통과');
    expect(screen.root.findAllByProps({ testID: 'walking-contract-complete' })).toHaveLength(0);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => { screen.root.findByProps({ testID: 'walking-contract-http-complete' }).props.onPress(); });
    expect(run).toHaveBeenLastCalledWith('http-complete');
    expect(JSON.stringify(screen.toJSON())).toContain('자동 길안내 OFF');
});

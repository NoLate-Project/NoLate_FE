import React from 'react';
import TestRenderer, {act, type ReactTestRenderer} from 'react-test-renderer';
import {JourneySubwayObservationTrial} from '../src/modules/journey/JourneySubwayObservationTrial';
jest.mock('../src/modules/journey/subwayObservationDiagnostic', () => ({
    subwayDiagnosticCases: [['complete', '정상 열차 관측'], ['stale', '오래된 관측 차단']], loadSubwayObservationDiagnostic: jest.fn(),
}));
import {loadSubwayObservationDiagnostic} from '../src/modules/journey/subwayObservationDiagnostic';
let screen: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => {act(() => screen?.unmount());});
test('explicit diagnostic only and success cleared while next response is pending or failed', async () => {
    const run = loadSubwayObservationDiagnostic as jest.Mock;
    run.mockResolvedValueOnce({case: 'complete', status: 'TRAIN_REFERENCES_ONLY', matchingTrainCount: 1, providerCalls: 1, authorityReads: 2});
    await act(async () => {screen = TestRenderer.create(<JourneySubwayObservationTrial/>);});
    expect(run).not.toHaveBeenCalled();
    await act(async () => {screen.root.findByProps({accessibilityLabel: '정상 열차 관측'}).props.onPress();});
    expect(JSON.stringify(screen.toJSON())).toContain('열차 관측 1개 · 탑승 미확정');
    let reject!: () => void;
    run.mockImplementationOnce(() => new Promise((_, fail) => {reject = () => fail(new Error('private body'));}));
    await act(async () => {
        screen.root.findByProps({accessibilityLabel: '오래된 관측 차단'}).props.onPress();
        screen.root.findByProps({accessibilityLabel: '정상 열차 관측'}).props.onPress();
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(screen.toJSON())).not.toContain('열차 관측 1개');
    await act(async () => {reject();});
    expect(JSON.stringify(screen.toJSON())).toContain('서버 연결 실패 · 이전 결과 사용 안 함');
    expect(JSON.stringify(screen.toJSON())).not.toContain('private body');
    expect(JSON.stringify(screen.toJSON())).toContain('GPS 미사용');
});
test('late response after unmount does not publish a result', async () => {
    let resolve!: (value: unknown) => void;
    (loadSubwayObservationDiagnostic as jest.Mock).mockImplementationOnce(() => new Promise(done => {resolve = done;}));
    await act(async () => {screen = TestRenderer.create(<JourneySubwayObservationTrial/>);});
    await act(async () => {screen.root.findByProps({accessibilityLabel: '정상 열차 관측'}).props.onPress();});
    act(() => screen.unmount());
    await act(async () => {resolve({case: 'complete', matchingTrainCount: 1});});
    expect(screen.toJSON()).toBeNull();
});

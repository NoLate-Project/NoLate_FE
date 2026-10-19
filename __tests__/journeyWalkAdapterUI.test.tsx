import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import Screen from '../app/internal/journey-walk-adapter';
jest.mock('expo-router', () => ({ Redirect: 'Redirect' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
const runtime = globalThis as typeof globalThis & { __DEV__: boolean; IS_REACT_ACT_ENVIRONMENT: boolean };
test('same production parser shows pass/reject/recovery but never grants automatic guidance', async () => {
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
    let view!: Renderer.ReactTestRenderer;
    await act(async () => { view = Renderer.create(<Screen />); });
    expect(view.root.findByProps({ testID: 'walk-adapter-result' }).props.children).toBe('원본 연결 검사 통과');
    for (const [id, reason] of [['gap', 'DISCONNECTED_LINES'], ['invalid', 'INVALID_COORDINATE'], ['endpoint', 'ENDPOINT_MISMATCH']]) {
        await act(async () => view.root.findByProps({ testID: `walk-adapter-${id}` }).props.onPress());
        expect(view.root.findByProps({ testID: 'walk-adapter-result' }).props.children).toContain(reason);
        expect(view.root.findAllByProps({ testID: 'walk-adapter-counts' })).toHaveLength(0);
        expect(view.root.findByProps({ testID: 'walk-adapter-guidance' }).props.children).toContain('OFF');
    }
    await act(async () => view.root.findByProps({ testID: 'walk-adapter-complete' }).props.onPress());
    expect(view.root.findByProps({ testID: 'walk-adapter-counts' }).props.children.join('')).toContain('원본 4점 · 전달 3점');
    await act(async () => view.unmount());
});
test('release screen redirects without exposing fixtures', async () => {
    const old = runtime.__DEV__; runtime.__DEV__ = false;
    let view!: Renderer.ReactTestRenderer;
    try {
        await act(async () => { view = Renderer.create(<Screen />); });
        expect(view.root.findAllByProps({ testID: 'walk-adapter-result' })).toHaveLength(0);
        await act(async () => view.unmount());
    } finally { runtime.__DEV__ = old; }
});

import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { SavedJourneyRouteBar } from '../src/modules/journey/SavedJourneyRouteBar';
import { ScheduleDetailRouteQuickSummary } from '../src/routeSupport/schedule/ScheduleDetailRouteQuickSummary';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import type { ScheduleDetailPresentation } from '../src/routeSupport/schedule/scheduleDetailPresentationModel';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/routeSupport/schedule/ScheduleDetailChrome', () => ({ APP_ACCENT_BLUE: '#1264C7',
    IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT: 196, SHEET_HANDLE_HEIGHT: 28, Ionicons: 'Ionicons', CompactRouteProgressStrip: 'Strip' }));
jest.mock('../src/modules/journey/SavedJourneyGuidanceCard', () => ({ SavedJourneyGuidanceCard: () => require('react').createElement('View', { testID: 'stress-guidance' }) }));
const route = { legs: Array.from({ length: 32 }, (_, index) => ({ index, kind: index === 0 ? 'WALK' : 'BUS' })) } as JourneyRouteInput;

it('preserves full long labels and every original ordinal without line truncation', () => {
    const name = '합성 시험 노선 · 매우 긴 노선명을 끝까지 읽을 수 있어야 하는 접근성 검증 전용 버스';
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<SavedJourneyRouteBar input={route} position={null} layout={{ basis: 'EQUAL', caption: '구간 동일 폭',
        legs: route.legs.map(leg => ({ ...leg, label: name, color: '#FFF5A0', fraction: 1 / 32, durationMinutes: null })) }} />); });
    for (let index = 0; index < 32; index++) {
        const label = view.root.findByProps({ testID: `saved-journey-route-label-${index}` });
        expect(label.props.numberOfLines).toBeUndefined(); expect(label.props.allowFontScaling).not.toBe(false);
        expect(label.props.accessibilityLabel).toBe(`${index + 1}. ${name}`);
    }
    act(() => view.unmount());
});
it('exposes compact GPS guidance separately from expand buttons and allows scrolling', () => {
    const presentation = { sheetMode: 'compact', sheetQuickSummaryAnimatedStyle: {}, routeIdentityTitle: '시험 출발 → 도착',
        snapSheet: jest.fn(), recommendedDepartureTimeLabel: '12:00', routeFactLabels: [], routeProgressSegments: [],
        item: { id: '9001' }, primaryText: '#111', secondaryText: '#444', topCardAccentText: '#1264C7' } as unknown as ScheduleDetailPresentation;
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteQuickSummary presentation={presentation} automaticGuidancePrepared automaticRouteInput={route} />); });
    const guidance = view.root.findByProps({ testID: 'stress-guidance' });
    let parent = guidance.parent;
    while (parent) { expect(parent.type).not.toBe(Pressable); parent = parent.parent; }
    expect(view.root.findAllByType(ScrollView).length).toBeGreaterThan(0);
    act(() => view.unmount());
});

it('remeasures route text when system font scale changes without changing route progress', () => {
    const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions');
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<SavedJourneyRouteBar input={route} position={null} />); });
    const before = view.root.findByProps({ testID: 'saved-journey-route-label-0' });
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 3.12 });
    act(() => { view.update(<SavedJourneyRouteBar input={route} position={null} />); });
    expect(view.root.findByProps({ testID: 'saved-journey-route-label-0' })).not.toBe(before);
    expect(view.root.findAllByProps({ testID: 'saved-journey-route-marker' })).toHaveLength(0);
    act(() => view.unmount());
    dimensions.mockRestore();
});

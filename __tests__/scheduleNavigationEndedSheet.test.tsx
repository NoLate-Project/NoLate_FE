import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { ScheduleDetailRouteSheet } from '../src/routeSupport/schedule/ScheduleDetailRouteSheet';
import type { ScheduleDetailPresentation } from '../src/routeSupport/schedule/scheduleDetailPresentationModel';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/modules/journey/journeyFeature', () => ({ isAutomaticJourneyEntryEnabled: () => true }));
let mockGuidance: Record<string, unknown> = {};
afterEach(() => { mockGuidance = {}; });
jest.mock('../src/modules/journey/useSavedJourneyGuidanceView', () => ({ useSavedJourneyGuidanceView: () => mockGuidance }));
jest.mock('../src/modules/journey/SavedJourneyTrialControls', () => ({
    SavedJourneyTrialControls: (props: unknown) => require('react').createElement('GuidancePreparation', { ...props as object, testID: 'guidance-preparation' }),
}));
jest.mock('../src/modules/journey/JourneyNavigationOptions', () => ({ JourneyNavigationOptions: (props: unknown) => require('react').createElement('JourneyOptions', props) }));
jest.mock('../src/modules/journey/SavedJourneyRouteTimeline', () => ({ SavedJourneyRouteTimeline: () => null }));
jest.mock('../src/modules/schedule/components/detail/ScheduleSharingInformation', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/modules/schedule/components/detail/ImportedTicketSummary', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/routeSupport/schedule/ScheduleDetailRouteQuickSummary', () => ({
    ScheduleDetailRouteQuickSummary: () => null,
}));

function presentation(reason?: string): ScheduleDetailPresentation {
    return {
        currentMemberId: 7, authoritativeDetailLoaded: true, navigationMode: true, isPlainSchedule: false,
        item: { id: '363', ownerMemberId: 7, travelMode: 'TRANSIT' },
        navigationEnd: reason ? { scheduleId: '363', reason } : undefined,
        departureOverview: { departedCount: 0 }, participantPresentations: [], routeFactLabels: [],
        primaryText: '#111', secondaryText: '#555', topCardAccentText: '#2979FF',
        sheetMode: 'compact', sheetMaxHeight: 480, sheetBottomPadding: 34, sheetTranslateY: 0,
        sheetPanResponder: { panHandlers: {} }, sheetScrollRef: { current: null },
        snapSheet: jest.fn(),
    } as unknown as ScheduleDetailPresentation;
}

test('route inspection has one guidance entry; preparation appears after entering navigation', () => {
    const enter = jest.fn();
    const base = { ...presentation(), navigationMode: false, sheetMode: 'expanded',
        hasDetailedRoute: true, departureCompleted: true, journeyGuidanceAvailable: true,
        completeDeparture: enter } as unknown as ScheduleDetailPresentation;
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet presentation={base}
        companionCount={1} renderRouteCompanions={() => null} />); });
    expect(view.root.findAllByProps({ testID: 'guidance-preparation' })).toHaveLength(0);
    const entry = view.root.findByProps({ testID: 'schedule-route-departure-action' });
    expect(entry.props.accessibilityLabel).toBe('길안내 보기');
    act(() => entry.props.onPress());
    expect(enter).toHaveBeenCalledTimes(1);
    act(() => view.update(<ScheduleDetailRouteSheet presentation={{ ...base, navigationMode: true }}
        companionCount={1} renderRouteCompanions={() => null} />));
    expect(view.root.findAllByProps({ testID: 'guidance-preparation' }).length).toBeGreaterThan(0);
    act(() => view.unmount());
});

test('transit route summary keeps its single departure action in the bottom dock', () => {
    const enter = jest.fn();
    const planner = jest.fn();
    const base = { ...presentation(), scheduleScreenVisible: true, openCurrentRoutePlanner: planner, navigationMode: false, sheetMode: 'expanded',
        hasDetailedRoute: true, displayTravelMode: 'TRANSIT', journeyGuidanceAvailable: true,
        displayedRouteMinutes: 188, routeDurationLabel: '188분', recommendedDepartureTimeLabel: '04:54',
        departureDateLabel: '11월 28일 (토)', insets: { bottom: 0 }, completeDeparture: enter,
    } as unknown as ScheduleDetailPresentation;
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet presentation={base}
        companionCount={1} renderRouteCompanions={() => null} />); });
    const dock = view.root.findByProps({ testID: 'route-browse-action-dock' });
    expect(JSON.stringify(view.toJSON())).toContain('3시간 8분');
    expect(JSON.stringify(view.toJSON())).not.toContain('저장한 경로');
    expect(JSON.stringify(view.toJSON())).not.toContain('위치 사용 · 최대 2시간');
    expect(dock.findByProps({ testID: 'schedule-route-departure-action' }).props.accessibilityLabel).toBe('길안내 시작');
    const action = dock.findByProps({ testID: 'schedule-route-departure-action' });
    expect(JSON.stringify(view.toJSON()).match(/"testID":"schedule-route-departure-action"/g)).toHaveLength(1);
    const overview = view.root.findByProps({ testID: 'route-sheet-overview' });
    expect(overview.findAllByProps({ accessibilityLabel: '길찾기에서 경로 보기' })).toHaveLength(0);
    act(() => dock.findByProps({ testID: 'schedule-route-guidance-settings' }).props.onPress());
    act(() => view.root.findByType('JourneyOptions' as never).props.onChangeRoute());
    expect(planner).toHaveBeenCalledTimes(1);
    act(() => action.props.onPress());
    expect(enter).toHaveBeenCalledTimes(1);
    act(() => view.unmount());
});

test.each([undefined, 'DESTINATION_ARRIVED', 'STOPPED', 'EXPIRED'])(
    'only an unstarted navigation offers preparation, terminal reason=%s', reason => {
        let view!: ReactTestRenderer;
        act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet presentation={presentation(reason)}
            companionCount={1} renderRouteCompanions={() => null} />); });
        expect(view.root.findAllByProps({ testID: 'schedule-route-guidance-entry' }).length > 0).toBe(reason === undefined);
        act(() => view.unmount());
    },
);

test('an authenticated ended Live Activity handoff cannot offer new guidance preparation', () => {
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet
        presentation={{ ...presentation(), guidanceEndedHandoff: true }}
        companionCount={1} renderRouteCompanions={() => null} />); });
    expect(view.root.findAllByProps({ testID: 'schedule-route-guidance-entry' })).toHaveLength(0);
    act(() => view.unmount());
});

test('coordinator cleanup waits for the owned terminal snapshot without offering a new preparation', () => {
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet
        presentation={{ ...presentation(), navigationReconciling: true }}
        companionCount={1} renderRouteCompanions={() => null} />); });
    expect(view.root.findAllByProps({ testID: 'schedule-route-guidance-entry' })).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).toContain('안내 상태를 확인 중이에요');
    act(() => view.unmount());
});

test('the active footer retains the route bar and opens its owned hamburger settings in both sheet modes', () => {
    const input = { legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ kind, index, stops: [] })) };
    mockGuidance = { input, snapshot: { status: 'ACTIVE', sessionId: 'owned' },
        binding: { scheduleId: '363', sessionId: 'owned', generation: 1 },
        layout: { legs: input.legs.map(leg => ({ ...leg, fraction: 1 / 3, color: '#2979FF', durationMinutes: 4, label: leg.kind })) } };
    const base = { ...presentation(), scheduleScreenVisible: true, insets: { bottom: 0 }, routeProgressSegments: [],
        routeDurationLabel: '12분', hasDetailedRoute: true } as unknown as ScheduleDetailPresentation;
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet presentation={base} companionCount={1} renderRouteCompanions={() => null} />); });
    expect(view.root.findByProps({ testID: 'journey-navigation-footer' })).toBeDefined();
    expect(JSON.stringify(view.toJSON())).toContain('예정 12분');
    act(() => view.root.findByProps({ testID: 'journey-navigation-menu' }).props.onPress());
    expect(view.root.findByType('GuidancePreparation' as never).props.navigationMenu.open).toBe(true);
    act(() => view.update(<ScheduleDetailRouteSheet presentation={{ ...base, sheetMode: 'expanded' }} companionCount={1} renderRouteCompanions={() => null} />));
    expect(view.root.findByProps({ testID: 'journey-navigation-footer' })).toBeDefined();
    expect(view.root.findByProps({ testID: 'journey-navigation-expanded-summary' })).toBeDefined();
    expect(view.root.findByType('GuidancePreparation' as never).props.navigationMenu.open).toBe(true);
    act(() => view.unmount());
});

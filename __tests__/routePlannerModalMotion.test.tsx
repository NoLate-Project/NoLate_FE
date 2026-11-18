import React from 'react';
import { Animated, Modal, Platform, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { RoutePlannerModals } from '../src/modules/schedule/routePlanner/RoutePlannerModals';
import { RoutePlannerMapHeader } from '../src/modules/schedule/routePlanner/RoutePlannerMapHeader';
import { RoutePlannerAlternativeSection } from '../src/modules/schedule/routePlanner/RoutePlannerAlternativeSection';
import { RoutePlannerBottomSheet } from '../src/modules/schedule/routePlanner/RoutePlannerBottomSheet';
import { useRoutePlannerCameraSync } from '../src/modules/schedule/routePlanner/useRoutePlannerCameraSync';
import { useRoutePlannerSubmissionActions } from '../src/modules/schedule/routePlanner/useRoutePlannerSubmissionActions';
import { consumeScheduleRouteUpdatePayload, getRoutePlannerInitial } from '../src/modules/schedule/routePlannerSession';
import type { RoutePlannerController } from '../src/modules/schedule/routePlanner/useRoutePlannerController';
import type { ScheduleItem } from '../src/modules/schedule/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('../src/ui/BrandedLoader', () => 'BrandedLoader');
jest.mock('../src/modules/schedule/components/route/RouteStepTimeline', () => 'RouteStepTimeline');
jest.mock('../src/api/api', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('../src/modules/map/routingService', () => ({
  shouldShowRequiredMapAttribution: () => false,
}));

it('fits the full route once the moving sheet has reached its viewport', async () => {
  const fitToCoordinates = jest.fn();
  const animateCameraTo = jest.fn();
  type CameraOptions = Parameters<typeof useRoutePlannerCameraSync>[0];
  const options: Omit<CameraOptions, 'bottomSheetSnap' | 'isBottomSheetCollapsed' | 'reduceMotion' |
    'transitMapBottomOcclusionHeight' | 'visibleBottomSheetHeight'> = {
    activeTarget: null,
    bottomPanelHeight: 420,
    bottomSheetCollapsedOffset: 320,
    bottomSheetExpandedOffset: 40,
    bottomSheetMiddleOffset: 180,
    cameraQaStateRef: { current: { cameraMode: 'ROUTE_OVERVIEW', autoFitSuppressed: false, reason: 'INITIAL_ROUTE_FIT' } },
    destinationLat: 37.4979,
    destinationLng: 127.0276,
    etaLoading: false,
    hasBottomSheetMeasured: true,
    hasRouteReady: true,
    insetsTop: 0,
    isBottomSheetHidden: false,
    isMapInitialized: true,
    isQaCameraLocked: false,
    isRouteDetailMode: true,
    isTransitDetailMode: false,
    lastCameraActionKeyRef: { current: '' },
    mapRef: { current: { fitToCoordinates, animateCameraTo, animateRegionTo: jest.fn(), resizeMap: jest.fn(), zoomBy: jest.fn() } },
    originLat: 37.5547,
    originLng: 126.9707,
    requestedTransitDepartureAt: new Date('2026-11-17T00:00:00Z'),
    routeRefreshTick: 0,
    runCameraActionAfterDirectionPrewarm: (_key, _center, _zoom, action) => action(),
    transitConnectorOverlays: [],
    transitWalkDetailOverlays: [],
    travelMode: 'WALK',
    windowHeight: 780,
    windowWidth: 375,
  };

  function CameraHarness({
    visibleHeight,
    snap = 'expanded',
    reduceMotion = false,
  }: { visibleHeight: number; snap?: CameraOptions['bottomSheetSnap']; reduceMotion?: boolean }) {
    useRoutePlannerCameraSync({
      ...options,
      bottomSheetSnap: snap,
      isBottomSheetCollapsed: snap !== 'expanded',
      reduceMotion,
      transitMapBottomOcclusionHeight: visibleHeight,
      visibleBottomSheetHeight: visibleHeight,
    });
    return null;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = TestRenderer.create(<CameraHarness visibleHeight={100} />); });
    await act(async () => { renderer!.update(<CameraHarness visibleHeight={240} />); });
    expect(fitToCoordinates).not.toHaveBeenCalled();

    await act(async () => { renderer!.update(<CameraHarness visibleHeight={378} />); });
    await act(async () => { renderer!.update(<CameraHarness visibleHeight={380} />); });
    expect(fitToCoordinates).toHaveBeenCalledTimes(1);

    await act(async () => { renderer!.update(<CameraHarness visibleHeight={240} snap="collapsed" />); });
    expect(fitToCoordinates).toHaveBeenCalledTimes(1);
    await act(async () => { renderer!.update(<CameraHarness visibleHeight={100} snap="collapsed" />); });
    expect(fitToCoordinates).toHaveBeenCalledTimes(2);

    options.lastCameraActionKeyRef.current = '';
    await act(async () => { renderer!.update(<CameraHarness visibleHeight={100} reduceMotion />); });
    expect(animateCameraTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
  } finally {
    await act(async () => renderer?.unmount());
  }
});

it('updates both planner modals when the system motion preference changes', async () => {
  const originalPlatform = Platform.OS;
  Platform.OS = 'ios';
  let renderer: ReactTestRenderer | undefined;
  const controller = {
    colors: {},
    draftTransitDepartureAt: new Date(),
    isTransitDeparturePickerOpen: true,
    locationPromptTarget: 'origin',
    reduceMotion: false,
  } as RoutePlannerController;

  try {
    await act(async () => {
      renderer = TestRenderer.create(<RoutePlannerModals controller={controller} />);
    });
    const modalAnimations = () => renderer!.root.findAllByType(Modal).map(modal => modal.props.animationType);
    expect(modalAnimations()).toEqual(['fade', 'fade']);

    await act(async () => {
      renderer!.update(<RoutePlannerModals controller={{ ...controller, reduceMotion: true }} />);
    });
    expect(modalAnimations()).toEqual(['none', 'none']);
  } finally {
    await act(async () => renderer?.unmount());
    Platform.OS = originalPlatform;
  }
});

it('describes the edited endpoints and opens origin search from the map', async () => {
  const openRoutePointEditorFromHeader = jest.fn();
  const controller = {
    colors: {},
    insets: { top: 0 },
    isRouteDetailMode: true,
    isTransitMode: true,
    departureTimeEdited: true,
    etaLoading: true,
    originDisplay: '서울역',
    destinationDisplay: '강남역',
    openRoutePointEditorFromHeader,
  } as unknown as RoutePlannerController;
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = TestRenderer.create(<RoutePlannerMapHeader controller={controller} />);
    });
    const edit = renderer!.root.findAll(node =>
      node.props.accessibilityLabel === '출발지와 도착지 수정' && typeof node.props.onPress === 'function',
    )[0]!;
    expect(edit.props.accessibilityValue).toEqual({ text: '서울역 → 강남역' });
    expect(edit.findAll(node => node.props.name === 'pencil-outline').length).toBeGreaterThan(0);
    act(() => edit.props.onPress());
    expect(openRoutePointEditorFromHeader).toHaveBeenCalledWith('origin');
  } finally {
    await act(async () => renderer?.unmount());
  }
});

it.each([false, true])('settles the selected map candidate only when motion is enabled (%s)', async reduceMotion => {
  const selectAlternativeByIndex = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: jest.fn(), stop: jest.fn(), reset: jest.fn(),
  }));
  const controller = {
    colors: {},
    insets: { top: 0 },
    isRouteDetailMode: true,
    isTransitMode: true,
    visibleAlternatives: [
      { id: 'mixed', mode: 'TRANSIT', minutes: 41 },
      { id: 'bus', mode: 'TRANSIT', minutes: 38, transitLegs: [{ kind: 'BUS' }] },
    ],
    selectedAlternativeId: 'mixed',
    selectAlternativeByIndex,
    reduceMotion,
  } as unknown as RoutePlannerController;
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = TestRenderer.create(<RoutePlannerMapHeader controller={controller} />); });
    const choice = (id: string) => renderer!.root.findAll(node =>
      node.props.testID === `route-planner-map-choice-${id}` && typeof node.props.onPress === 'function',
    )[0];
    expect(choice('mixed').props.accessibilityState).toEqual({ selected: true });
    act(() => choice('mixed').props.onPress());
    expect(selectAlternativeByIndex).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
    expect(choice('bus').props.accessibilityLabel).toBe('버스 · 38분');
    act(() => choice('bus').props.onPress());
    expect(selectAlternativeByIndex).toHaveBeenCalledWith(1);
    await act(async () => {
      renderer!.update(<RoutePlannerMapHeader controller={{ ...controller, selectedAlternativeId: 'bus' }} />);
    });
    expect(choice('bus').props.accessibilityState).toEqual({ selected: true });
    expect(choice('bus').findAllByProps({ testID: 'route-planner-map-choice-highlight' }).length).toBeGreaterThan(0);
    expect(timing).toHaveBeenCalledTimes(reduceMotion ? 0 : 1);
    if (!reduceMotion) {
      expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        duration: 160, useNativeDriver: true,
      }));
    }
  } finally {
    await act(async () => renderer?.unmount());
    timing.mockRestore();
  }
});

it.each([false, true])('keeps search feedback in the sheet and settles the new route (reduceMotion=%s)', async reduceMotion => {
  const route = { id: 'route-41', mode: 'TRANSIT', minutes: 41 };
  const controller = {
    colors: {},
    isTransitMode: true,
    isTransitDetailMode: true,
    isDark: false,
    departureTimeEdited: true,
    requestedTransitDepartureAt: new Date(2026, 10, 15, 13, 30),
    reduceMotion,
    etaLoading: false,
    routeAlternatives: [route],
    visibleAlternatives: [route],
    selectedAlternative: route,
    transitDetailSummaryPalette: {},
    routeDetailSummarySurface: {},
  } as unknown as RoutePlannerController;
  const onRevealFirstStop = jest.fn();
  const renderSheet = (props: RoutePlannerController) => (
    <RoutePlannerAlternativeSection controller={props} onRevealFirstStop={onRevealFirstStop} />
  );
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = TestRenderer.create(renderSheet(controller)); });
    const animatedResult = () => renderer!.root.findAll(node => node.props.entering?.duration === 160);
    expect(animatedResult()).toHaveLength(0);
    await act(async () => {
      renderer!.update(renderSheet({ ...controller, etaLoading: true }));
    });
    expect(renderer!.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityLabel)
      .toBe('경로를 찾고 있어요, 11월 15일 오후 1:30 출발');
    expect(renderer!.root.findByType('BrandedLoader' as never).props).toMatchObject({
      size: 'button', settleMark: true,
    });
    await act(async () => { renderer!.update(renderSheet(controller)); });
    expect(renderer!.root.findAllByProps({ accessibilityRole: 'progressbar' })).toHaveLength(0);
    expect(animatedResult().length > 0).toBe(!reduceMotion);
  } finally {
    await act(async () => renderer?.unmount());
  }
});

it.each([
  ['expanded', false, true],
  ['expanded', true, false],
  ['collapsed', false, false],
] as const)('updates the route timeline in %s (reduced motion: %s)', async (bottomSheetSnap, reduceMotion, animates) => {
  const buildController = (id: string, minutes: number) => {
    const route = { id, mode: 'TRANSIT', minutes, transitServiceState: 'unknown' };
    return {
      colors: {},
      isTransitMode: true,
      isTransitDetailMode: true,
      bottomSheetSnap,
      reduceMotion,
      routeAlternatives: [route],
      visibleAlternatives: [route],
      selectedAlternative: route,
      selectedTransitMeta: { combinedText: '예상 소요 시간 · 1,500원', fareText: '1,500원' },
      selectedRouteInfo: { id, departureTime: new Date(2026, 10, 15, 13, 19).toISOString(),
        totalDurationMinutes: minutes, steps: [{ id: 'leg-1', type: 'SUBWAY' }] },
      transitDetailSummaryPalette: {},
      routeDetailSummarySurface: {},
    } as unknown as RoutePlannerController;
  };
  const render = (id: string, minutes: number) => (
    <RoutePlannerAlternativeSection controller={buildController(id, minutes)} onRevealFirstStop={jest.fn()} />
  );
  let renderer: ReactTestRenderer | undefined;
  const timeline = () => renderer!.root.findByType('RouteStepTimeline' as never);
  const content = () => renderer!.root.findAll(node => node.props.testID === 'route-planner-detail-content')[0];
  try {
    await act(async () => { renderer = TestRenderer.create(render('route-a', 41)); });
    expect(content().props.entering).toBeUndefined();
    const departureBasis = renderer!.root.findAllByType(Text)
      .find(node => node.props.testID === 'route-planner-departure-basis');
    expect(React.Children.toArray(departureBasis?.props.children).join('')).toBe('13:19 출발 기준');
    const first = timeline();
    expect(first.props.showEstimatedClockHeading).toBe(true);
    expect(first.props.realtimeArrivalsActive).toBe(bottomSheetSnap !== 'collapsed');
    await act(async () => renderer!.update(render('route-a', 42)));
    expect(timeline()).toBe(first);
    expect(content().props.entering).toBeUndefined();
    await act(async () => renderer!.update(render('route-b', 38)));
    expect(timeline()).not.toBe(first);
    expect(timeline().props.routeInfo.id).toBe('route-b');
    expect(Boolean(content().props.entering)).toBe(animates);
  } finally {
    await act(async () => renderer?.unmount());
  }
});

it('keeps the route action mounted and disabled while a new route is loading', async () => {
  const route = {
    id: 'route-41', mode: 'TRANSIT', minutes: 41,
    transitLegs: [
      { kind: 'WALK', startName: '서울역', endName: '서울역 4호선', durationMinutes: 5, distanceMeters: 340 },
      { kind: 'SUBWAY', durationMinutes: 20 },
    ],
  };
  const snapBottomSheetTo = jest.fn();
  const controller = {
    colors: {},
    isRouteDetailMode: true,
    isTransitMode: true,
    hasRouteReady: true,
    bottomSheetSnap: 'middle',
    bottomSheetTranslateY: new Animated.Value(0),
    bottomHandlePanResponder: { panHandlers: {} },
    shouldReturnToScheduleDetail: true,
    selectedAlternative: route,
    visibleAlternatives: [route],
    routeAlternatives: [route],
    selectedTransitProgressSegments: [],
    transitDetailSummaryPalette: {},
    routeDetailSummarySurface: {},
    canSubmitRoute: true,
    routeSubmitPending: false,
    selectedRouteDuration: '41분',
    selectedRouteInfo: { id: route.id, departureTime: new Date(2026, 10, 15, 13, 19).toISOString(), steps: [] },
    selectedTransitMeta: { fareText: '1,500원' },
    selectedCollapsedRouteSummary: { arrivalText: '오후 2:00 예상 도착' },
    snapBottomSheetTo,
  } as unknown as RoutePlannerController;
  let renderer: ReactTestRenderer | undefined;
  const action = () => renderer!.root.findAll(node =>
    node.props.accessibilityLabel === '선택한 경로를 일정에 적용' && typeof node.props.disabled === 'boolean')[0];
  try {
    await act(async () => { renderer = TestRenderer.create(<RoutePlannerBottomSheet controller={controller} />); });
    const initialAction = action();
    expect(initialAction?.props.disabled).toBe(false);
    const footerSummary = () => renderer!.root.findAllByProps({ testID: 'route-planner-footer-summary' });
    expect(footerSummary()[0].findAllByType(Text).map(node => node.props.children))
      .toEqual(['오후 2:00 예상 도착', '총 41분 · 1,500원']);
    const accessWalk = () => renderer!.root.findAllByProps({ testID: 'route-planner-overview-access-walk' });
    expect(accessWalk()).toHaveLength(0);
    await act(async () => {
      renderer!.update(<RoutePlannerBottomSheet controller={{
        ...controller,
        bottomSheetSnap: 'collapsed',
        focusedTransitLegIndex: 1,
        selectedTransitProgressSegments: [
          { key: 'walk', kind: 'WALK', label: '5분', minutes: 5, isRide: false, color: '#687588', flex: 5 },
          { key: 'rail', kind: 'SUBWAY', lineLabel: '4호선', label: '20분', minutes: 20, isRide: true, color: '#00A4E3', flex: 20 },
        ],
      }} />);
    });
    const disclosure = renderer!.root.findAll(node =>
      node.props.accessibilityLabel === '경로 상세 펼치기' && typeof node.props.onPress === 'function')[0];
    expect(disclosure.props.accessibilityValue).toEqual({ text: '예상 41분, 13:19 출발 기준 · 오후 2:00 예상 도착, 이동 경로, 도보 5분, 4호선 20분, 지도 선택: 4호선 20분' });
    expect(renderer!.root.findAllByProps({ testID: 'route-planner-overview-scroll' }).length).toBeGreaterThan(0);
    expect(footerSummary()).toHaveLength(0);
    expect(accessWalk()[0].props.accessibilityLabel).toBe('서울역 출발, 서울역 4호선, 도보 340m · 5분');
    expect(renderer!.root.findAllByProps({ accessibilityLabel: '지도에서 전체 경로 보기' })).toHaveLength(0);
    const collapsedHandle = renderer!.root.findAll(node =>
      node.props.testID === 'route-planner-overview-handle' && typeof node.props.onPress === 'function')[0];
    expect(collapsedHandle.props.accessibilityState).toEqual({ expanded: false });
    act(() => collapsedHandle.props.onPress());
    act(() => disclosure.props.onPress());
    expect(snapBottomSheetTo).toHaveBeenCalledWith('expanded');
    const segments = renderer!.root.findAll(node =>
      node.props.testID === 'route-planner-overview-segments' && typeof node.props.onPress === 'function')[0];
    act(() => segments.props.onPress());
    expect(snapBottomSheetTo).toHaveBeenCalledTimes(3);
    expect(action()).toBe(initialAction);
    await act(async () => {
      renderer!.update(<RoutePlannerBottomSheet controller={{
        ...controller, visibleAlternatives: [],
        routeAlternatives: [], etaLoading: true, canSubmitRoute: false,
      }} />);
    });
    expect(renderer!.root.findAllByProps({ testID: 'route-planner-overview-segments' })).toHaveLength(0);
    expect(action()).toBe(initialAction);
    expect(action()?.props.disabled).toBe(true);
    expect(action()?.props.accessibilityState).toEqual({ disabled: true, busy: false });
  } finally {
    await act(async () => renderer?.unmount());
  }
});

it.each([false, true])('reveals the selected summary once per collapse (%s reduced motion)', async reduceMotion => {
  const route = { id: 'mixed', mode: 'TRANSIT', minutes: 41 };
  const bus = { ...route, id: 'bus', minutes: 38 };
  const controller = {
    colors: {},
    isRouteDetailMode: true,
    isTransitMode: true,
    hasRouteReady: true,
    reduceMotion,
    bottomSheetTranslateY: new Animated.Value(0),
    bottomHandlePanResponder: { panHandlers: {} },
    selectedTransitProgressSegments: [],
    transitDetailSummaryPalette: {},
    routeDetailSummarySurface: {},
  } as unknown as RoutePlannerController;
  const render = (bottomSheetSnap: RoutePlannerController['bottomSheetSnap'], candidate = route) => (
    <RoutePlannerBottomSheet controller={{
      ...controller,
      bottomSheetSnap,
      selectedAlternative: candidate as RoutePlannerController['selectedAlternative'],
      routeAlternatives: [],
      visibleAlternatives: [],
      selectedRouteDuration: `${candidate.minutes}분`,
    }} />
  );
  const start = jest.fn();
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start, stop, reset: jest.fn() });
  let renderer: ReactTestRenderer | undefined;
  const summary = () => renderer!.root.findAllByProps({ testID: 'route-planner-overview-summary' });
  try {
    await act(async () => { renderer = TestRenderer.create(render('collapsed')); });
    expect(summary().length).toBeGreaterThan(0);
    expect(start).not.toHaveBeenCalled();

    await act(async () => renderer!.update(render('expanded')));
    expect(summary()).toHaveLength(0);
    await act(async () => renderer!.update(render('expanded', bus)));
    expect(start).not.toHaveBeenCalled();

    await act(async () => renderer!.update(render('collapsed', bus)));
    expect(summary().length).toBeGreaterThan(0);
    const disclosure = renderer!.root.findAll(node =>
      node.props.accessibilityLabel === '경로 상세 펼치기' && typeof node.props.onPress === 'function')[0];
    expect(disclosure.props.accessibilityValue).toEqual({ text: '예상 38분' });
    expect(start).toHaveBeenCalledTimes(reduceMotion ? 0 : 1);
    if (!reduceMotion) {
      expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
        duration: 160, useNativeDriver: true,
      }));
    }

    await act(async () => renderer!.update(render('collapsed', { ...bus })));
    expect(start).toHaveBeenCalledTimes(reduceMotion ? 0 : 1);
    await act(async () => renderer!.update(render('expanded', bus)));
    expect(summary()).toHaveLength(0);
    expect(stop).toHaveBeenCalledTimes(reduceMotion ? 0 : 1);
  } finally {
    await act(async () => renderer?.unmount());
    timing.mockRestore();
  }
});

it('keeps the planner in place until a new endpoint is selected', async () => {
  const sessionId = 'test-planner-endpoint-editor';
  const replace = jest.fn();
  const options = {
    router: { replace },
    sessionId,
    originName: '서울역',
    originAddress: '',
    originLat: 37.55,
    originLng: 126.97,
    destinationName: '강남역',
    destinationAddress: '',
    destinationLat: 37.49,
    destinationLng: 127.03,
    travelMode: 'TRANSIT',
    bottomSheetSnap: 'expanded',
    routePlannerBackAction: 'close',
    selectedAlternative: { id: 'route-41', mode: 'TRANSIT', minutes: 41 },
    mapPathOverlays: [],
    etaMinutes: 41,
    initialTargetArrivalAt: '2026-11-15T14:00:00+09:00',
  } as unknown as Parameters<typeof useRoutePlannerSubmissionActions>[0];
  let actions: ReturnType<typeof useRoutePlannerSubmissionActions> | undefined;
  function Harness() {
    actions = useRoutePlannerSubmissionActions(options);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = TestRenderer.create(<Harness />); });
    act(() => actions!.openRoutePointEditorFromHeader('origin'));
    expect(actions!.placeEditor).toMatchObject({
      target: 'origin',
      initial: {
        origin: { name: '서울역' },
        destination: { name: '강남역' },
        route: { id: 'route-41' },
        targetArrivalAt: '2026-11-15T14:00:00+09:00',
      },
    });
    act(() => actions!.closePlaceEditor());
    expect(actions!.placeEditor).toBeUndefined();
    expect(getRoutePlannerInitial(sessionId)).toBeUndefined();
    expect(replace).not.toHaveBeenCalled();

    act(() => actions!.openRoutePointEditorFromHeader('origin'));
    act(() => actions!.confirmRoutePoints(
      { name: '시청역', lat: 37.56, lng: 126.98 },
      { name: '강남역', lat: 37.49, lng: 127.03 },
    ));
    expect(getRoutePlannerInitial(sessionId)).toMatchObject({
      origin: { name: '시청역' },
      destination: { name: '강남역' },
      route: undefined,
      travelMinutes: undefined,
      targetArrivalAt: '2026-11-15T14:00:00+09:00',
    });
    expect(replace).toHaveBeenCalledWith({
      pathname: '/schedule/route-select',
      params: { sessionId },
    });
  } finally {
    await act(async () => renderer?.unmount());
  }
});

it.each([true, false])('applies the currently selected candidate to the schedule once (timeline available=%s)', async hasTimeline => {
  const back = jest.fn();
  const sessionId = `apply-switched-route-${hasTimeline}`;
  const startAt = '2026-11-15T14:00:00+09:00';
  const item: ScheduleItem = {
    id: 'schedule-1', title: '약속', startAt, endAt: '2026-11-15T15:00:00+09:00',
    category: { id: 'personal', title: '개인', color: '#2979FF' }, allDay: false,
    notes: '서쪽 출구에서 만나요',
  };
  const resetTimer = { current: null as ReturnType<typeof setTimeout> | null };
  const pending = { current: false };
  let actions: ReturnType<typeof useRoutePlannerSubmissionActions>;
  const route = (id: string, minutes: number, odsayTimetablePreview?: { departureAt: string; arrivalAt: string }) => ({
    id, minutes, mode: 'TRANSIT', pathCoords: [{ lat: 37.55, lng: 126.97 }, { lat: 37.49, lng: 127.03 }], odsayTimetablePreview,
  });
  function Harness({ candidate, departureAt }: { candidate: ReturnType<typeof route>; departureAt: string }) {
    actions = useRoutePlannerSubmissionActions({
      router: { canGoBack: () => true, back },
      sessionId,
      originName: '서울역', originAddress: '', originLat: 37.55, originLng: 126.97,
      destinationName: '강남역', destinationAddress: '', destinationLat: 37.49, destinationLng: 127.03,
      travelMode: 'TRANSIT',
      initialTargetArrivalAt: startAt,
      finalSelectedRouteDepartureTime: departureAt,
      selectedAlternative: candidate,
      selectedRouteInfo: hasTimeline ? { id: candidate.id, totalDurationMinutes: candidate.minutes } : undefined,
      etaMinutes: 41,
      etaLoading: false,
      hasRouteReady: true,
      buildCanSubmitRoute: true,
      mapPathOverlays: [],
      routeSubmitPendingRef: pending,
      routeSubmitResetTimerRef: resetTimer,
      setRouteSubmitPending: jest.fn(),
    } as unknown as Parameters<typeof useRoutePlannerSubmissionActions>[0]);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = TestRenderer.create(<Harness candidate={route('mixed', 41)} departureAt="2026-11-15T13:19:00+09:00" />);
    });
    const scheduledDeparture = '2026-11-15T13:20:00+09:00';
    const subway = route('odsay-subway', 40, { departureAt: scheduledDeparture, arrivalAt: startAt });
    await act(async () => renderer!.update(<Harness candidate={subway} departureAt={scheduledDeparture} />));
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(scheduledDeparture));
    try {
      act(() => actions.submit());
      expect(consumeScheduleRouteUpdatePayload(sessionId, item)).toBeUndefined();
      expect(back).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
    const bus = route('bus', 38);
    const departureAt = '2026-11-15T13:22:00+09:00';
    await act(async () => renderer!.update(<Harness candidate={bus} departureAt={departureAt} />));
    act(() => {
      actions.submit();
      actions.submit();
    });
    expect(back).toHaveBeenCalledTimes(1);
    expect(consumeScheduleRouteUpdatePayload(sessionId, item)).toMatchObject({
      title: item.title, startAt, endAt: item.endAt, category: item.category, notes: item.notes,
      departAt: departureAt, travelMinutes: 38,
      route: { id: 'bus', pathCoords: bus.pathCoords },
    });
    expect(consumeScheduleRouteUpdatePayload(sessionId, item)).toBeUndefined();
  } finally {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    await act(async () => renderer?.unmount());
  }
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import TmapMapView, { type TmapMapViewHandle, type TmapMarker } from '../map/TmapMapView';
import { styleNonTransitOverlay } from '../map/savedRouteMapOverlays';
import type { Place } from '../schedule/types';
import {
  shouldMoveFollowingCamera,
  shouldPauseFollowingCamera,
} from '../../routeSupport/schedule/navigationMapFollow';
import { drivingTurnPath, drivingTurnTitle, type DrivingCoordinate } from './drivingGuidance';
import { readDrivingVoicePreference, saveDrivingVoicePreference, useDrivingPublication } from './useDrivingPublication';
import { useDrivingNavigation } from './useDrivingNavigation';
export { canStartSavedDrive } from './useDrivingNavigation';

const entrance = FadeInDown.duration(200).reduceMotion(ReduceMotion.System);
const turnIcons: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  '11': 'arrow-up-outline',
  '12': 'return-up-back-outline',
  '13': 'return-up-forward-outline',
  '14': 'return-down-back-outline',
  '16': 'return-up-back-outline',
  '17': 'return-up-back-outline',
  '18': 'return-up-forward-outline',
  '19': 'return-up-forward-outline',
  '117': 'arrow-forward-outline',
  '118': 'arrow-back-outline',
  '201': 'flag-outline',
};

function distance(meters: number) {
  return meters < 1000 ? Math.round(meters) + 'm' : (meters / 1000).toFixed(1) + 'km';
}

type Props = {
  scheduleId: string;
  savedRoute: unknown;
  origin: Place;
  destination: Place;
  isDark: boolean;
  onExit: () => void;
  departureRecorded: boolean;
  onDeparted: () => Promise<void>;
};

export function DrivingNavigationScreen({
  scheduleId,
  savedRoute,
  origin,
  destination,
  isDark,
  onExit,
  departureRecorded,
  onDeparted,
}: Props) {
  useKeepAwake('NoLateDrivingNavigation');
  const insets = useSafeAreaInsets();
  const {
    route,
    view,
    freshFix,
    heading,
    locationError,
    routeError,
    rerouting,
    now,
    refreshRoute,
    retryLocation,
    departureConfirmed,
  } = useDrivingNavigation(savedRoute, origin, destination);
  const lastDepartureAttempt = useRef(0);
  useEffect(() => {
    if (departureRecorded || !departureConfirmed || now - lastDepartureAttempt.current < 60000) return;
    lastDepartureAttempt.current = now;
    onDeparted().catch(() => { /* The next confirmed movement can retry the record. */ });
  }, [departureConfirmed, departureRecorded, now, onDeparted]);
  const ref = useRef<TmapMapViewHandle>(null);
  const previous = useRef<DrivingCoordinate | undefined>(undefined);
  const cameraTarget = useRef<DrivingCoordinate | undefined>(undefined);
  const previousBearing = useRef<number | undefined>(undefined);
  const cameraBusyUntil = useRef(0);
  const [ready, setReady] = useState(false);
  const [pitch, setPitch] = useState(0);
  const [following, setFollowing] = useState(true);
  const point = view.matchedCoordinate ?? freshFix;
  const recenter = useCallback(() => {
    if (!ready) return;
    const position = point ?? { latitude: origin.lat!, longitude: origin.lng! };
    previous.current = position;
    // Keep the last orientation while stopped. Only a fresh course moves the
    // focal point ahead, leaving room on screen for the upcoming road.
    const radians = (heading ?? 0) * Math.PI / 180;
    const ahead = heading == null ? 0 : 55;
    const target = {
      latitude: position.latitude + ahead * Math.cos(radians) / 111195,
      longitude: position.longitude + ahead * Math.sin(radians) /
        (111195 * Math.max(0.01, Math.cos(position.latitude * Math.PI / 180))),
    };
    cameraTarget.current = target;
    if (heading != null) previousBearing.current = heading;
    cameraBusyUntil.current = Date.now() + 1100;
    ref.current?.animateCameraTo({
      ...target,
      pitchDegrees: 40,
      bearingDegrees: previousBearing.current,
      zoom: 17,
      duration: 280,
    });
  }, [point, ready, origin.lat, origin.lng, heading]);
  useEffect(() => {
    if (!following || !ready) return;
    const old = previousBearing.current;
    const turned = heading != null && (old == null || Math.abs(((heading - old + 540) % 360) - 180) >= 8);
    if (!previous.current || turned || (point && shouldMoveFollowingCamera(previous.current, point))) recenter();
  }, [point, heading, following, ready, recenter]);
  const camera = useMemo(
    () => ({ latitude: origin.lat!, longitude: origin.lng!, zoom: 16 }),
    [origin.lat, origin.lng],
  );
  const latitude = point?.latitude;
  const longitude = point?.longitude;
  const next = view.nextManeuver;
  const offRoute = view.status === 'OFF_ROUTE';
  const approaching = view.status === 'GUIDING' && view.metersToNext != null && view.metersToNext <= 180;
  const paths = useMemo(() => {
    if (!route) return [];
    const road = styleNonTransitOverlay({ mode: 'CAR' }, { id: 'active-drive', coords: route.coordinates }, 17, isDark);
    if (offRoute) return [{ ...road, color: isDark ? '#8895A3' : '#647487', nativeDirection: false }];
    const coords = next && approaching ? drivingTurnPath(route, next) : [];
    if (!coords.length) return [road];
    return [road, {
      id: 'upcoming-driving-turn',
      coords,
      color: '#FFFFFF',
      width: 5,
      outlineColor: '#172935',
      outlineWidth: 1.75,
      zIndex: 80,
    }];
  }, [route, isDark, next, approaching, offRoute]);
  const markers = useMemo(
    (): TmapMarker[] => [
      {
        id: 'drive-destination',
        latitude: destination.lat!,
        longitude: destination.lng!,
        displayType: 'pin',
        markerStyle: 'destination',
        pinLabel: '도착',
      },
      ...(latitude !== undefined && longitude !== undefined
        ? [
            {
              id: 'drive-position',
              latitude,
              longitude,
              displayType: 'dot' as const,
              courseDegrees: heading ?? undefined,
              tintColor: '#1876FF',
              dotSize: 18,
              markerScale: 1.4,
              zIndex: 900,
            },
          ]
        : []),
    ],
    [latitude, longitude, heading, destination.lat, destination.lng],
  );
  const after = view.followingManeuver;
  const arrived = view.status === 'ARRIVED';
  const action = locationError
    ? '위치 다시 확인'
    : routeError && !route
    ? '경로 다시 받기'
    : offRoute && freshFix && !rerouting
    ? routeError ? '새 경로 다시 찾기' : '현재 위치에서 새 경로'
    : null;
  const status = !route
    ? routeError ? '주행 경로를 불러오지 못했어요' : '주행 경로를 불러오는 중'
    : locationError ||
      (arrived
        ? '목적지에 도착했어요'
        : offRoute && rerouting
        ? '현재 위치에서 새 경로를 찾는 중'
        : offRoute && routeError
        ? '새 경로를 찾지 못했어요'
        : offRoute
        ? '경로를 벗어났어요'
        : view.status === 'UNCERTAIN'
        ? '현재 위치를 다시 확인 중'
        : view.status === 'GUIDING'
        ? '목적지까지 이동'
        : '현재 위치를 확인하는 중');
  const remainingTime =
    view.remainingSeconds !== null && !arrived ? Math.max(1, Math.ceil(view.remainingSeconds / 60)) : null;
  const clock = remainingTime === null ? null : new Date(now + (view.remainingSeconds ?? 0) * 1000);
  const eta = clock
    ? String(clock.getHours()).padStart(2, '0') + ':' + String(clock.getMinutes()).padStart(2, '0')
    : null;
  const destinationLabel = destination.name || destination.address || '목적지';
  const backgroundColor = isDark ? '#202329' : '#FFFFFF';
  const color = isDark ? '#F8FAFD' : '#151B24';
  const secondary = isDark ? '#BFCCD9' : '#536172';
  const instruction = next?.instruction ?? status;
  const [voiceEnabled, setVoiceEnabled] = useState(readDrivingVoicePreference);
  useDrivingPublication(scheduleId, destinationLabel, route, view, voiceEnabled);

  return (
    <View testID="driving-navigation-screen" style={[styles.screen, { backgroundColor }]}>
      <TmapMapView
        ref={ref}
        camera={camera}
        markers={markers}
        pathOverlays={paths}
        routeFocusMode
        nightModeEnabled={isDark}
        showCompass={false}
        showLocationButton={false}
        showZoomControls={false}
        onLoadStateChange={state => setReady(state === 'ready')}
        onCameraChanged={value => {
          setPitch(Math.round(value.pitchDegrees ?? 0));
          if (
            following &&
            cameraTarget.current &&
            shouldPauseFollowingCamera(value, cameraTarget.current, Date.now(), cameraBusyUntil.current)
          )
            setFollowing(false);
        }}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="box-none"
        style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: Math.max(8, insets.bottom) }]}
      >
        <View pointerEvents="box-none" style={styles.chromeRow}>
          <Reanimated.View entering={entrance} style={styles.instruction}>
            <View
              testID="driving-navigation-instruction"
              accessible
              accessibilityLabel={[view.metersToNext !== null && distance(view.metersToNext), instruction]
                .filter(Boolean)
                .join(', ')}
              style={styles.turnRow}
            >
              <Ionicons
                name={
                  next
                    ? turnIcons[next.turnType] ?? 'navigate-outline'
                    : arrived
                    ? 'flag-outline'
                    : 'locate-outline'
                }
                size={38}
                color="#FFF"
              />
              <View style={styles.turnCopy}>
                {view.metersToNext !== null && (
                  <Text maxFontSizeMultiplier={1.5} style={styles.distance}>
                    {distance(view.metersToNext)}
                  </Text>
                )}
                <Text style={styles.turnTitle}>{next ? drivingTurnTitle(next) : status}</Text>
                {next?.roadName && (
                  <Text style={styles.road} numberOfLines={2}>
                    {next.roadName}
                  </Text>
                )}
              </View>
            </View>
            {after && (
              <View testID="driving-navigation-following" style={styles.following}>
                <Ionicons name={turnIcons[after.turnType] ?? 'navigate-outline'} size={17} color="#E5EEFF" />
                <Text numberOfLines={2} style={styles.followingText}>
                  이어서 {distance(Math.max(0, after.alongMeters - (next?.alongMeters ?? 0)))} 뒤{' '}
                  {drivingTurnTitle(after)}
                </Text>
              </View>
            )}
          </Reanimated.View>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="주행 음성 안내"
            accessibilityState={{ checked: voiceEnabled }}
            accessibilityHint="다음 주행에도 이 설정을 사용해요"
            onPress={() => {
              const enabled = !voiceEnabled;
              saveDrivingVoicePreference(enabled);
              setVoiceEnabled(enabled);
            }}
            style={[styles.voice, { backgroundColor }]}
          >
            <Ionicons
              name={voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
              color={color}
              size={22}
            />
          </Pressable>
        </View>
        <View style={styles.footer}>
          {point && (
            <Pressable
              onPress={() => {
                setFollowing(true);
                recenter();
              }}
              accessibilityRole="button"
              accessibilityLabel="현재 위치 따라가기"
              accessibilityValue={{ text: [following ? '현재 위치를 따라가는 중' : '지도를 둘러보는 중',
                pitch > 0 ? `지도 기울기 ${pitch}도` : '평면 지도'].join(', ') }}
              style={[styles.locate, { backgroundColor }]}
            >
              <Ionicons name="locate-outline" size={23} color={following ? '#2874D6' : color} />
            </Pressable>
          )}
          <View style={[styles.trip, { backgroundColor }]}>
            <View testID="driving-navigation-arrival-summary" accessible style={styles.tripCopy}>
              <Text style={[styles.place, { color: secondary }]} numberOfLines={1}>
                {destinationLabel}
              </Text>
              <Text style={[styles.time, { color }]}>
                {arrived ? '도착' : eta ? eta + ' 도착 예정' : '자차 길안내'}
              </Text>
              {view.remainingMeters !== null && !arrived && (
                <Text style={[styles.meta, { color: secondary }]}>
                  {remainingTime !== null ? remainingTime + '분 · ' : ''}
                  {distance(view.remainingMeters)} 남음
                </Text>
              )}
            </View>
            <Pressable
              testID="driving-navigation-exit"
              accessibilityRole="button"
              accessibilityLabel="주행 안내 종료"
              onPress={onExit}
              style={styles.end}
            >
              <Ionicons name="close-outline" size={20} color={color} />
              <Text style={{ color }}>종료</Text>
            </Pressable>
          </View>
          {action && (
            <View style={[styles.actions, { backgroundColor }]}>
              <Pressable
                accessibilityRole="button"
                style={styles.action}
                onPress={locationError ? retryLocation : refreshRoute}
              >
                <Text style={[styles.actionText, { color }]}>{action}</Text>
              </Pressable>
              {!!locationError && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.action}
                  onPress={() => {
                    Linking.openSettings().catch(() => Alert.alert('설정을 열 수 없어요', 'iOS 설정에서 NoLate의 위치 권한을 확인해 주세요.'));
                  }}
                >
                  <Text style={[styles.actionText, { color }]}>설정 열기</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, paddingHorizontal: 12, justifyContent: 'space-between' },
  chromeRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  voice: { height: 46, width: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23 },
  instruction: {
    alignSelf: 'flex-start',
    flexShrink: 1,
    backgroundColor: '#104DA8',
    borderRadius: 14,
    overflow: 'hidden',
  },
  turnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  turnCopy: { flexShrink: 1, gap: 2 },
  distance: { color: '#FFFFFF', fontSize: 39, fontWeight: '800', fontVariant: ['tabular-nums'] },
  turnTitle: { fontSize: 20, color: '#FFFFFF', fontWeight: '700', flexShrink: 1 },
  road: { fontSize: 15, color: '#E2EDFF' },
  following: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#133C78',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  followingText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  footer: { gap: 8 },
  locate: {
    alignSelf: 'flex-end',
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  trip: {
    paddingHorizontal: 17,
    paddingVertical: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tripCopy: { flex: 1, gap: 3 },
  place: { fontSize: 14, fontWeight: '600' },
  time: { fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  meta: { fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'] },
  end: { alignItems: 'center', justifyContent: 'center', minHeight: 48, minWidth: 48 },
  actions: { borderRadius: 12, flexDirection: 'row' },
  action: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 16, fontWeight: '600' },
});

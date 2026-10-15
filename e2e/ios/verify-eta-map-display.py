#!/usr/bin/env python3
"""Compare visible door-to-door predictions, not hidden train clocks or actual trip accuracy.

Keep the stricter same-service/platform/clock verifier separate. Different walking
models are a diagnostic here, not a reason to silently skip the visible ETA gap.
"""
import argparse
import datetime as dt
import json
import math
from pathlib import Path


def instant(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timezone required')
    return result


def coordinates(value):
    result = []
    for side in ('origin', 'destination'):
        point = value[side]
        lat, lng = point['lat'], point['lng']
        if (type(lat) not in (int, float) or type(lng) not in (int, float)
                or not math.isfinite(lat) or not math.isfinite(lng)
                or not -90 <= lat <= 90 or not -180 <= lng <= 180):
            raise ValueError('Explicit finite request coordinates required')
        result.append((lat, lng))
    return result


def compare(worker, public, map_display):
    if (worker.get('classification') != 'REAL_PROVIDER_ISOLATED_WORKER'
            or worker.get('database') != 'H2_MEMORY_ONLY'
            or worker.get('clockMode') != 'SYSTEM_WALL_CLOCK'
            or worker.get('providersMocked') is not False
            or worker.get('source') != 'LIVE_PROVIDER' or worker.get('stale') is not False
            or worker.get('failureReason') is not None
            or (worker.get('effectiveSnapshot') or {}).get('accepted') is not True):
        raise ValueError('A current accepted real-provider Worker result is required')
    route = worker['effectiveSnapshot']['effectiveTransitRoute']
    if (public.get('source') != 'LIVE_PROVIDER' or public.get('stale') is not False
            or public.get('failureReason') is not None or public.get('confidence') != 'HIGH'
            or public.get('scheduleId') != worker['scheduleId']
            or public.get('effectiveTransitRoute') != route
            or public.get('predictedArrivalAt') != route['arrivalAt']):
        raise ValueError('The app API must still expose the same accepted prediction')
    return compare_inputs(worker, route, map_display)


def compare_timetable_preview(worker, public, map_display):
    """Separate future timetable display evidence; never an accepted real-time ETA pass."""
    snapshot = worker.get('effectiveSnapshot') or {}
    route = snapshot.get('effectiveTransitRoute') or {}
    reason = worker.get('failureReason') or ''
    if (worker.get('classification') != 'REAL_PROVIDER_ISOLATED_WORKER'
            or worker.get('database') != 'H2_MEMORY_ONLY' or worker.get('clockMode') != 'SYSTEM_WALL_CLOCK'
            or worker.get('providersMocked') is not False or worker.get('source') != 'TIMETABLE_PROVIDER'
            or worker.get('stale') is not True or snapshot.get('accepted') is not False
            or snapshot.get('transitTimingBasis') != 'TIMETABLE_ONLY'
            or snapshot.get('firstBoardingObservation') is not None
            or not reason.startswith('TRANSIT_TRAIN_NOT_YET_OBSERVED:')
            or worker.get('predictedArrivalAt') is not None
            or public.get('source') != worker['source'] or public.get('stale') is not True
            or public.get('failureReason') != reason or public.get('scheduleId') != worker['scheduleId']
            or public.get('predictedArrivalAt') is not None or public.get('effectiveTransitRoute') is not None
            or public.get('firstBoardingObservation') is not None or public.get('confidence') != 'LOW'
            or public.get('futureTimetablePrediction') != route or not route):
        raise ValueError('Only the separate unobserved-train future timetable preview is eligible')
    window = public.get('_isolationReadWindow') or {}
    started, finished = instant(window['startedAt']), instant(window['finishedAt'])
    if not instant(worker['evaluatedAt']) <= started <= finished < instant(route['departureAt']) or instant(route['arrivalAt']) > instant(worker['targetArrivalAt']):
        raise ValueError('The app must still expose this future, on-time timetable preview')
    for segment in route['segments']:
        if segment['kind'] == 'WALK':
            continue
        timing = segment['rideTiming']
        table = timing['timetable']
        if (timing['basis'] != 'TIMETABLE' or table['provider'] != 'seoul-timetable'
                or timing['predictedBoardingAt'] != table['boardingAt']
                or timing['predictedArrivalAt'] != table['arrivalAt']):
            raise ValueError('Do not mix real-time ride evidence into timetable-only comparison')
    result = compare_inputs(worker, route, map_display)
    result.update(classification='TIMETABLE_ONLY_FUTURE_DISPLAY_DIAGNOSTIC',
                  result='TIMETABLE_DISPLAY_COMPARED' if result['result'] == 'DISPLAY_COMPARED' else result['result'],
                  acceptedRealtimeEtaVerified=False, futureTimetableDisplayOnly=True)
    return result


def compare_inputs(worker, route, map_display):
    if (map_display.get('provider') != 'NAVER_MAP_PUBLIC_UI'
            or map_display.get('mocked') is not False
            or map_display.get('queryMode') != 'DEPART_AT'):
        raise ValueError('Explicit public map display evidence required')
    if map_display.get('arrivalClockRounding') != 'UNKNOWN':
        raise ValueError('Do not invent a rounding contract for the map minute clock')
    app_departure, map_query = instant(route['departureAt']), instant(map_display['requestedDepartureAt'])
    app_observed, map_observed = instant(worker['evaluatedAt']), instant(map_display['observedAt'])
    map_departure, map_arrival = instant(map_display['suggestedDepartureAt']), instant(map_display['displayedArrivalAt'])
    if not map_observed < map_query <= map_departure < map_arrival:
        raise ValueError('The map must have been captured before its requested future departure')
    rides = [s for s in route['segments'] if s['kind'] != 'WALK']
    topology = [(s['kind'], s['rideTiming']['timetable']['line'], s['fromName'], s['toName']) for s in rides]
    map_topology = [(s['kind'], s['line'], s['fromName'], s['toName']) for s in map_display['rides']]
    cursor = map_departure
    for ride in map_display['rides']:
        boarding = instant(ride['displayedBoardingAt'])
        if boarding < cursor or boarding >= map_arrival or boarding.second or boarding.microsecond:
            raise ValueError('Ordered visible minute boarding clocks required')
        cursor = boarding
    exclusions = []
    if app_departure != map_query:
        exclusions.append('COMPUTED_DEPARTURE_MISMATCH')
    if app_observed >= app_departure:
        exclusions.append('APP_NOT_CAPTURED_BEFORE_FUTURE_DEPARTURE')
    if abs((app_observed - map_observed).total_seconds()) > 300:
        exclusions.append('CAPTURE_TIME_SKEW')
    if coordinates(worker['requestedCoordinates']) != coordinates(map_display['requestedCoordinates']):
        exclusions.append('REQUEST_COORDINATES_MISMATCH')
    if topology != map_topology:
        exclusions.append('VISIBLE_ROUTE_MISMATCH')
    delta = (instant(route['arrivalAt']) - map_arrival).total_seconds()
    comparable = not exclusions
    return {
        'classification': 'DISPLAYED_DOOR_TO_DOOR_PREDICTION_DIAGNOSTIC',
        'result': 'DISPLAY_COMPARED' if comparable else 'INPUTS_NOT_MATCHED',
        'exclusionReasons': exclusions,
        'requestedDepartureAt': map_display['requestedDepartureAt'],
        'appComputedDepartureAt': route['departureAt'],
        'protectedAlarmDepartureAt': worker['recommendedDepartureAt'],
        'appArrivalAt': route['arrivalAt'], 'naverDisplayedArrivalAt': map_display['displayedArrivalAt'],
        'nominalArrivalDeltaSeconds': delta,
        'nominalDisplayGapWithinTwoMinutes': abs(delta) <= 120 if comparable else None,
        'appTrains': [{'number': s['rideTiming']['timetable']['trainNumber'],
                       'boardingAt': s['rideTiming']['predictedBoardingAt'],
                       'arrivalAt': s['rideTiming']['predictedArrivalAt']} for s in rides],
        'naverVisibleBoardingClocks': [s['displayedBoardingAt'] for s in map_display['rides']],
        'appWalkingSeconds': [s['durationSeconds'] if s.get('durationSeconds') is not None else s['durationMinutes'] * 60
                              for s in route['segments'] if s['kind'] == 'WALK'],
        # This diagnostic compares user-visible products; it cannot prove these unknowns.
        'mapMinuteClockRounding': 'UNKNOWN', 'sameTrainIdentityVerified': False,
        'stationPlatformWalkingCoverageVerified': False,
        'mapAccuracyWithinTwoMinutesVerified': False, 'actualTripAccuracyVerified': False,
        'snapshotEvidence': map_display['snapshotEvidence'],
    }


def verify_snapshot(map_display, snapshot):
    # Only visible text is checked. No hidden endpoint, inferred train number or alighting time.
    normalized = ' '.join(snapshot.split())
    labels = map_display['visibleEvidenceLabels']
    if not labels or any(not label.strip() or ' '.join(label.split()) not in normalized for label in labels):
        raise ValueError('Map labels must exist in the saved public UI snapshot')
    zone = dt.timezone(dt.timedelta(hours=9))
    query = instant(map_display['requestedDepartureAt']).astimezone(zone)
    observed = instant(map_display['observedAt']).astimezone(zone)
    if query.date() != observed.date():
        raise ValueError('This snapshot protocol supports the explicitly visible today label only')
    period = '오전' if query.hour < 12 else '오후'
    query_label = f'오늘 {period} {query.hour % 12 or 12:02}:{query.minute:02} 출발'
    arrival = instant(map_display['displayedArrivalAt']).astimezone(zone)
    required = [query_label, f'도착 {arrival:%H:%M} ',
                *[instant(r['displayedBoardingAt']).astimezone(zone).strftime('%H:%M') + r['visibleTerminal']
                  for r in map_display['rides']]]
    if any(not any(part in label for label in labels) for part in required):
        raise ValueError('Structured clocks must match the exact labels in the visible evidence')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', type=Path, required=True)
    parser.add_argument('--public-status', type=Path, required=True)
    parser.add_argument('--map-display', type=Path, required=True)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--prediction-kind', choices=('accepted-realtime', 'future-timetable-preview'),
                        default='accepted-realtime')
    args = parser.parse_args()
    map_display = json.loads(args.map_display.read_text())
    verify_snapshot(map_display, args.snapshot.read_text())
    comparator = compare if args.prediction_kind == 'accepted-realtime' else compare_timetable_preview
    result = comparator(json.loads(args.worker.read_text()), json.loads(args.public_status.read_text()), map_display)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['result'] in ('DISPLAY_COMPARED', 'TIMETABLE_DISPLAY_COMPARED') else 3)

#!/usr/bin/env python3
"""Read-only walking/timetable accounting, not station-platform or trip accuracy proof.

No HTTP, DB, coordinate replacement, distance-to-time conversion or alarm changes.
Accepts a public status, Worker snapshot, or an EffectiveTransitRoute JSON document.
"""
import argparse
import datetime as dt
import json
import math
from pathlib import Path


def instant(value):
    if not isinstance(value, str):
        raise ValueError('Timestamp required')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timezone required')
    return parsed


def nonnegative_integer(value):
    return type(value) is int and value >= 0


def coordinate(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('Invalid coordinate')
    lat, lng = value.get('lat'), value.get('lng')
    if (type(lat) not in (int, float) or type(lng) not in (int, float)
            or not math.isfinite(lat) or not math.isfinite(lng)
            or not -90 <= lat <= 90 or not -180 <= lng <= 180):
        raise ValueError('Invalid coordinate')
    return lat, lng


def distance(a, b):
    if a is None or b is None:
        return None
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlng = lat2 - lat1, math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(max(0, min(1, h))))


def geometry_diagnostic(segment):
    geometry = segment.get('walkingGeometry') or {}
    if not isinstance(geometry, dict):
        raise ValueError('Invalid walking geometry')
    evidence = geometry.get('pathEvidence') or {}
    if not isinstance(evidence, dict):
        raise ValueError('Invalid path evidence')
    steps = evidence.get('steps') or []
    if not isinstance(steps, list) or len(steps) > 32:
        raise ValueError('Invalid walking steps')
    status = evidence.get('status', 'UNAVAILABLE')
    if (status not in ('PROVIDED', 'UNAVAILABLE', 'INVALID', 'LIMIT_EXCEEDED')
            or bool(steps) != (status == 'PROVIDED')):
        raise ValueError('Invalid walking path status')
    points = []
    for step in steps:
        if not isinstance(step, dict):
            raise ValueError('Invalid walking step')
        values = step.get('coordinates')
        if not isinstance(values, list) or not 2 <= len(values) <= 128:
            raise ValueError('Invalid step coordinates')
        points.append([coordinate(value) for value in values])
        if any(value is None for value in points[-1]):
            raise ValueError('Missing step coordinate')
    if sum(len(values) for values in points) > 512:
        raise ValueError('Walking path exceeds evidence bound')
    start, end = coordinate(geometry.get('from')), coordinate(geometry.get('to'))
    # Never connect gaps into a fabricated path or infer platform coverage from alignment.
    lengths = [sum(distance(a, b) for a, b in zip(values, values[1:])) for values in points]
    gaps = [distance(a[-1], b[0]) for a, b in zip(points, points[1:])]
    meters = geometry.get('distanceMeters')
    supplied = [step.get('distanceMeters') for step in steps]
    all_distances = bool(supplied) and all(type(value) in (int, float)
        and math.isfinite(value) and value >= 0 for value in supplied)
    rounded = lambda value: round(value, 2) if value is not None else None
    return {
        'sequence': segment['sequence'], 'scope': segment.get('walkingScope', 'UNKNOWN'),
        'durationSeconds': segment.get('durationSeconds') if nonnegative_integer(segment.get('durationSeconds')) else None,
        'providerDistanceMeters': meters if nonnegative_integer(meters) else None,
        'endpointBasis': geometry.get('endpointBasis', 'UNKNOWN'),
        'pathStatus': status,
        'nominalEndpointSeparationMeters': rounded(distance(start, end)),
        'pathStartOffsetMeters': rounded(distance(start, points[0][0])) if points else None,
        'pathEndOffsetMeters': rounded(distance(end, points[-1][-1])) if points else None,
        'sumWithinStepPolylineMeters': rounded(sum(lengths)) if points else None,
        'interStepGapsMeters': [rounded(value) for value in gaps],
        'sumProviderStepDistanceMeters': sum(supplied) if all_distances else None,
        'reportedStationInteriorCoverage': evidence.get('stationInteriorCoverage', 'UNKNOWN'),
        # No supported provider contract proves platform coverage; not a geographic guess.
        'stationInteriorCoverageVerified': False,
    }


def audit_route(route):
    if not isinstance(route, dict):
        raise ValueError('Route object required')
    segments = route.get('segments')
    if not isinstance(segments, list) or not 1 <= len(segments) <= 512:
        raise ValueError('Bounded ordered journey segments required')
    if any(not isinstance(s, dict) for s in segments):
        raise ValueError('Segment object required')
    if any(not nonnegative_integer(s.get('sequence')) for s in segments):
        raise ValueError('Sequence required')
    segments = sorted(segments, key=lambda s: s['sequence'])
    if [s['sequence'] for s in segments] != list(range(len(segments))):
        raise ValueError('Unique contiguous sequence required')
    walks = [s for s in segments if s['kind'] == 'WALK']
    diagnostics = [geometry_diagnostic(s) for s in walks]
    report = {'classification': 'WALKING_TIMELINE_AND_GEOMETRY_AUDIT_NOT_ACCURACY_PROOF',
        'timingResult': 'UNVERIFIED', 'reasons': [], 'walkingLegs': diagnostics,
        'stationInteriorCoverageVerified': False, 'realWorldAccuracyVerified': False,
        'etaOrAlarmModified': False}
    if (not walks or any(not nonnegative_integer(s.get('durationSeconds')) for s in walks)
            or any(s['kind'] not in ('WALK', 'SUBWAY') for s in segments)
            or not any(s['kind'] == 'SUBWAY' for s in segments)):
        report['reasons'] = ['MISSING_EXACT_WALKING_OR_SUBWAY_TIMING']
        return report
    cursor = instant(route['departureAt'])
    departure, arrival = cursor, instant(route['arrivalAt'])
    ride_seconds, wait_seconds, transitions, failures = 0, 0, [], []
    last_ride_arrival = None
    ride_positions = [i for i, s in enumerate(segments) if s['kind'] == 'SUBWAY']
    for segment in segments:
        if segment['kind'] == 'WALK':
            index = segment['sequence']
            expected_scope = 'ACCESS' if index < ride_positions[0] else 'EGRESS' if index > ride_positions[-1] else 'TRANSFER'
            if segment.get('walkingScope', 'UNKNOWN') not in ('UNKNOWN', expected_scope):
                failures.append('WALKING_SCOPE_POSITION_MISMATCH')
            minutes = segment.get('durationMinutes')
            if minutes is not None and (not nonnegative_integer(minutes)
                    or minutes != math.ceil(segment['durationSeconds'] / 60)):
                failures.append('WALKING_SECONDS_MINUTES_MISMATCH')
            cursor += dt.timedelta(seconds=segment['durationSeconds'])
            continue
        timing = segment.get('rideTiming') or {}
        if not isinstance(timing, dict):
            raise ValueError('Invalid ride timing')
        if not timing.get('predictedBoardingAt') or not timing.get('predictedArrivalAt'):
            report['reasons'] = ['MISSING_EXACT_WALKING_OR_SUBWAY_TIMING']
            return report
        boarding, alighting = instant(timing['predictedBoardingAt']), instant(timing['predictedArrivalAt'])
        gap, movement = (boarding - cursor).total_seconds(), (alighting - boarding).total_seconds()
        if gap < 0 or movement <= 0:
            failures.append('UNBOARDABLE_OR_REVERSED_RIDE')
        transitions.append({'sequence': segment['sequence'], 'readyAfterWalkingAt': cursor.isoformat(),
            'boardingAt': timing['predictedBoardingAt'], 'remainingBeforeBoardingSeconds': gap})
        # This gap includes any safety margin/wait; do not add rounded waitingMinutes again.
        wait_seconds += gap
        ride_seconds += movement
        cursor = last_ride_arrival = alighting
    elapsed = (arrival - departure).total_seconds()
    final_gap = (arrival - cursor).total_seconds()
    if final_gap != 0:
        failures.append('FINAL_ARRIVAL_DOES_NOT_MATCH_TRAILING_WALK')
    if elapsed <= 0 or type(route.get('totalMinutes')) is not int or route['totalMinutes'] != math.ceil(elapsed / 60):
        failures.append('TOTAL_DURATION_MISMATCH')
    total_walk = sum(s['durationSeconds'] for s in walks)
    last_ride_index = max(i for i, s in enumerate(segments) if s['kind'] == 'SUBWAY')
    trailing_walk = sum(s['durationSeconds'] for s in segments[last_ride_index + 1:])
    report.update(timingResult='FAILED' if failures else 'PASSED', reasons=failures,
        walkingSeconds=total_walk, rideSeconds=ride_seconds,
        waitingAndMarginsSeconds=wait_seconds, elapsedSeconds=elapsed,
        reconstructedSeconds=total_walk + ride_seconds + wait_seconds,
        trailingWalkingSeconds=trailing_walk,
        postLastAlightingSeconds=(arrival - last_ride_arrival).total_seconds(),
        finalArrivalResidualSeconds=final_gap, boardingTransitions=transitions)
    return report


def audit_document(document):
    if not isinstance(document, dict):
        raise ValueError('Evidence object required')
    route = document.get('effectiveTransitRoute')
    if route is None:
        snapshot = document.get('effectiveSnapshot') or {}
        if not isinstance(snapshot, dict):
            raise ValueError('Snapshot object required')
        route = snapshot.get('effectiveTransitRoute')
    if route is None and 'segments' in document:
        route = document
    if not isinstance(route, dict):
        raise ValueError('Current route evidence required; no saved/last-accepted substitution')
    return audit_route(route)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    args = parser.parse_args()
    try:
        result = audit_document(json.loads(args.evidence.read_text()))
    except (KeyError, TypeError, ValueError) as error:
        parser.exit(2, f'Invalid walking evidence: {type(error).__name__}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['timingResult'] == 'PASSED' else 1)

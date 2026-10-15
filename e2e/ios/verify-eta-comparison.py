#!/usr/bin/env python3
"""Compare prediction evidence; map agreement is never observed-trip accuracy.

Read-only CLI. Missing boundaries/time evidence excludes a sample rather than
turning unrelated map durations into a two-minute accuracy success.
"""
import argparse
import datetime as dt
import json
import math
from pathlib import Path


def instant(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('A timezone is required')
    return parsed


def validate(observation):
    for name in ('id', 'kind', 'evidence', 'queryMode', 'originBoundary', 'destinationBoundary'):
        if not isinstance(observation.get(name), str) or not observation[name].strip():
            raise ValueError(f'Missing {name}')
    if observation['kind'] not in ('PROVIDER_TIMETABLE', 'APP_PREDICTION', 'MAP_PREDICTION'):
        raise ValueError('This verifier only accepts predictions, not actual-trip claims')
    if not isinstance(observation.get('mocked'), bool):
        raise ValueError('Explicit mocked flag is required')
    observed = instant(observation['observedAt'])
    requested = instant(observation['requestedDepartureAt'])
    departure = instant(observation['departureAt'])
    arrival = instant(observation['arrivalAt'])
    if departure < requested or arrival <= departure:
        raise ValueError('Invalid prediction timeline')
    rides = observation['rides']
    if not isinstance(rides, list) or not rides:
        raise ValueError('Ride evidence is required')
    cursor = departure
    for ride in rides:
        for name in ('line', 'from', 'to', 'serviceClass', 'direction'):
            if not isinstance(ride.get(name), str) or not ride[name].strip():
                raise ValueError(f'Missing ride {name}')
        boarding, alighting = instant(ride['boardingAt']), instant(ride['arrivalAt'])
        if boarding < cursor or alighting <= boarding or alighting > arrival:
            raise ValueError('Invalid boarding/transfer timeline')
        cursor = alighting
    return observed, requested, departure, arrival


def walking_boundaries(observation):
    """Explicit manual boundary evidence; provider polylines alone cannot prove platform coverage.

    Legacy or missing legs are unknown, never implied zero-second walking.
    Durations are deliberately NOT part of equality: they are what we compare.
    """
    items = observation.get('walkingBoundaryEvidence')
    if items is None:
        return None
    if not isinstance(items, list):
        raise ValueError('Walking boundary evidence must be a list')
    expected = ['ACCESS'] + ['TRANSFER'] * (len(observation['rides']) - 1) + ['EGRESS']
    if len(items) != len(expected):
        return None
    result = []
    unknown = False
    kinds = ('STREET_COORDINATE', 'STATION_ENTRANCE', 'STATION_PLATFORM', 'UNKNOWN')
    for item, scope in zip(items, expected):
        if not isinstance(item, dict) or item.get('scope') != scope:
            raise ValueError('Walking scope/order mismatch')
        if not isinstance(item.get('evidence'), str) or not item['evidence'].strip():
            unknown = True
        coverage = item.get('stationInteriorCoverage')
        if coverage not in ('UNKNOWN', 'EXCLUDED', 'INCLUDED_TO_PLATFORM'):
            raise ValueError('Invalid station interior coverage')
        endpoints = []
        for key in ('from', 'to'):
            endpoint = item.get(key)
            if not isinstance(endpoint, dict) or endpoint.get('kind') not in kinds:
                raise ValueError('Invalid walking endpoint')
            if not isinstance(endpoint.get('id'), str) or not endpoint['id'].strip():
                raise ValueError('Walking endpoint ID is required')
            unknown |= endpoint['kind'] == 'UNKNOWN' or endpoint['id'] == 'UNKNOWN'
            endpoints.append((endpoint['kind'], endpoint['id']))
        # A nominal station coordinate/entrance is not the train's boarding platform.
        for index in ([1] if scope == 'ACCESS' else [0] if scope == 'EGRESS' else [0, 1]):
            unknown |= endpoints[index][0] != 'STATION_PLATFORM'
        # These scopes reach a boarding/alighting platform. An outside-only path
        # still leaves platform access unmeasured, even when both providers omit it.
        unknown |= coverage != 'INCLUDED_TO_PLATFORM'
        result.append((scope, *endpoints, coverage))
    unknown |= items[0]['from']['id'] != observation['originBoundary']
    unknown |= items[-1]['to']['id'] != observation['destinationBoundary']
    return None if unknown else result


def train_identities(observation):
    """A route label or equal clock is not proof of the same physical service.

    Keep provider namespaces and operating dates: train numbers repeat daily and
    may collide across operators. Never guess a hidden map train from its clock.
    Legacy evidence remains readable, but cannot pass this gate.
    """
    identities = []
    for ride in observation['rides']:
        item = ride.get('trainIdentity')
        if item is None:
            return None
        if not isinstance(item, dict):
            raise ValueError('Train identity must be an object')
        keys = ('namespace', 'serviceDate', 'number', 'evidence')
        if any(not isinstance(item.get(key), str) or not item[key].strip()
               or item[key] == 'UNKNOWN' for key in keys):
            return None
        date = dt.date.fromisoformat(item['serviceDate'])
        if date.isoformat() != item['serviceDate']:
            raise ValueError('Canonical service date required')
        if ride['line'] == 'UNKNOWN':
            return None
        identities.append((ride['line'], *(item[key] for key in ('namespace', 'serviceDate', 'number'))))
    return identities


def arrival_clock_bounds(observation):
    """Offsets from the displayed prediction, not uncertainty of actual travel.

    Minute clocks need an evidenced rounding contract. Unknown formatting is
    never silently interpreted as exact seconds or truncated minutes. Bounds
    include the next tick conservatively instead of inventing :59 precision.
    """
    item = observation.get('arrivalClockEvidence')
    if item is None:
        return None
    if not isinstance(item, dict):
        raise ValueError('Arrival clock evidence must be an object')
    resolution = item.get('resolutionSeconds')
    if type(resolution) is not int or not 1 <= resolution <= 3600:
        raise ValueError('Bounded integer arrival clock resolution required')
    rounding = item.get('rounding')
    if rounding not in ('EXACT', 'TRUNCATED', 'NEAREST', 'UNKNOWN'):
        raise ValueError('Invalid arrival clock rounding')
    if rounding == 'EXACT' and resolution != 1:
        raise ValueError('Coarse displayed clocks cannot be exact timestamps')
    if (rounding == 'UNKNOWN' or not isinstance(item.get('evidence'), str)
            or not item['evidence'].strip() or item['evidence'] == 'UNKNOWN'):
        return None
    if rounding != 'EXACT' and instant(observation['arrivalAt']).timestamp() % resolution != 0:
        raise ValueError('Displayed clock must align with its declared resolution')
    if rounding == 'EXACT':
        return 0, 0
    if rounding == 'TRUNCATED':
        return 0, resolution
    return -resolution / 2, resolution / 2


def worker_prediction(document, evidence):
    """Export the current accepted calculation, never the protected alarm baseline.

    The caller attaches UI verification separately. Provider station coordinates
    do not prove a platform or station-interior walking boundary. Those unknowns
    must survive export so a later map comparison cannot manufacture equality.
    """
    snapshot = document.get('effectiveSnapshot') or {}
    if (document.get('classification') != 'REAL_PROVIDER_ISOLATED_WORKER'
            or document.get('providersMocked') is not False
            or document.get('clockMode') != 'SYSTEM_WALL_CLOCK'
            or document.get('source') != 'LIVE_PROVIDER' or document.get('stale') is not False
            or document.get('failureReason') is not None or snapshot.get('accepted') is not True):
        raise ValueError('Current accepted real-provider Worker result required')
    route = snapshot['effectiveTransitRoute']
    if instant(route['arrivalAt']) != instant(document['predictedArrivalAt']):
        raise ValueError('Current route and prediction arrival must agree')
    segments = route['segments']
    if any(item['kind'] not in ('WALK', 'SUBWAY') for item in segments):
        raise ValueError('Only subway comparison export is supported')
    rides = []
    for item in segments:
        if item['kind'] != 'SUBWAY':
            continue
        timing = item['rideTiming']
        table = timing['timetable']
        rides.append({'line': table['line'], 'from': table['fromStationCode'],
            'to': table['toStationCode'], 'direction': table['directionCode'],
            'serviceClass': table['serviceClass'], 'boardingAt': timing['predictedBoardingAt'],
            'arrivalAt': timing['predictedArrivalAt'],
            'trainIdentity': {'namespace': table['provider'], 'serviceDate': table['serviceDate'],
                              'number': table['trainNumber'], 'evidence': evidence}})
    walks = [item for item in segments if item['kind'] == 'WALK']
    if not walks or walks[0].get('walkingScope') != 'ACCESS' or walks[-1].get('walkingScope') != 'EGRESS':
        raise ValueError('Explicit endpoint walking evidence required')

    def coordinate_id(value):
        if (not isinstance(value, dict)
                or any(type(value.get(k)) not in (int, float) or not math.isfinite(value[k]) for k in ('lat', 'lng'))
                or not -90 <= value['lat'] <= 90 or not -180 <= value['lng'] <= 180):
            return 'UNKNOWN'
        return f"coordinate:{value['lat']},{value['lng']}"

    origin = coordinate_id((walks[0].get('walkingGeometry') or {}).get('from'))
    destination = coordinate_id((walks[-1].get('walkingGeometry') or {}).get('to'))
    boundary_evidence = []
    for walk in walks:
        scope = walk['walkingScope']
        # Station endpoints have no verified platform identity even if the path
        # happens to end very close to the station's nominal coordinate.
        boundary_evidence.append({'scope': scope,
            'from': {'kind': 'STREET_COORDINATE' if scope == 'ACCESS' and origin != 'UNKNOWN' else 'UNKNOWN',
                     'id': origin if scope == 'ACCESS' else 'UNKNOWN'},
            'to': {'kind': 'STREET_COORDINATE' if scope == 'EGRESS' and destination != 'UNKNOWN' else 'UNKNOWN',
                   'id': destination if scope == 'EGRESS' else 'UNKNOWN'},
            'stationInteriorCoverage': 'UNKNOWN', 'evidence': evidence})
    observation = {'id': f"worker-{document['scheduleId']}-{document['latestHistoryId']}",
        'kind': 'APP_PREDICTION', 'mocked': False, 'evidence': evidence, 'queryMode': 'DEPART_AT',
        'observedAt': document['evaluatedAt'], 'requestedDepartureAt': route['departureAt'],
        'departureAt': route['departureAt'], 'arrivalAt': route['arrivalAt'],
        'originBoundary': origin, 'destinationBoundary': destination,
        'walkingBoundaryEvidence': boundary_evidence, 'rides': rides,
        'arrivalClockEvidence': {'resolutionSeconds': 1, 'rounding': 'EXACT',
            'evidence': evidence + '#effectiveSnapshot.effectiveTransitRoute.arrivalAt'},
        'protectedAlarmDepartureAt': document.get('recommendedDepartureAt'),
        'realWorldAccuracyVerified': False, 'simulatorE2eVerified': False}
    validate(observation)
    train_identities(observation)
    return observation


def timeline_budget(observation):
    """Partition elapsed time, without claiming a gap is measured walking/waiting."""
    _, requested, departure, arrival = validate(observation)
    rides = observation['rides']
    # These are timestamp gaps, not provider walking durations. A map may round
    # clocks or combine entrance/platform movement and waiting in the same gap.
    return {
        'suggestedDepartureOffsetSeconds': (departure - requested).total_seconds(),
        'accessAndFirstWaitSeconds': (instant(rides[0]['boardingAt']) - departure).total_seconds(),
        'rideSeconds': [(instant(ride['arrivalAt']) - instant(ride['boardingAt'])).total_seconds()
                        for ride in rides],
        'transferAndWaitSeconds': [(instant(b['boardingAt']) - instant(a['arrivalAt'])).total_seconds()
                                   for a, b in zip(rides, rides[1:])],
        'postAlightingResidualSeconds': (arrival - instant(rides[-1]['arrivalAt'])).total_seconds(),
        'requestedToArrivalSeconds': (arrival - requested).total_seconds(),
    }


def timeline_diagnostic(left, right):
    a, b = timeline_budget(left), timeline_budget(right)
    scalar_keys = ('suggestedDepartureOffsetSeconds', 'accessAndFirstWaitSeconds',
                   'postAlightingResidualSeconds', 'requestedToArrivalSeconds')
    deltas = {key: a[key] - b[key] for key in scalar_keys}
    for key in ('rideSeconds', 'transferAndWaitSeconds'):
        deltas[key] = [x - y for x, y in zip(a[key], b[key])]
    # Excluded samples can have different requested times. Preserve that
    # absolute offset rather than mislabelling elapsed-duration delta as ETA delta.
    deltas['requestedDepartureDeltaSeconds'] = (instant(left['requestedDepartureAt']) -
                                               instant(right['requestedDepartureAt'])).total_seconds()
    reconstructed = (deltas['requestedDepartureDeltaSeconds']
                     + deltas['suggestedDepartureOffsetSeconds'] + deltas['accessAndFirstWaitSeconds']
                     + sum(deltas['rideSeconds']) + sum(deltas['transferAndWaitSeconds'])
                     + deltas['postAlightingResidualSeconds'])
    return {
        'classification': 'ARITHMETIC_ONLY_NOT_CAUSAL_WALKING_OR_ACCURACY_PROOF',
        'leftBudget': a, 'rightBudget': b, 'leftMinusRight': deltas,
        'reconstructedArrivalDeltaSeconds': reconstructed,
    }


def compare(left, right, scope='SAME_SERVICE_TIMING'):
    if scope not in ('SAME_SERVICE_TIMING', 'DOOR_TO_DOOR_PREDICTION'):
        raise ValueError('Explicit supported comparison scope required')
    lt, rt = validate(left), validate(right)
    reasons = []
    if left['mocked'] or right['mocked']:
        reasons.append('MOCK_FEED')
    if left['queryMode'] != 'DEPART_AT' or right['queryMode'] != 'DEPART_AT':
        reasons.append('QUERY_MODE_UNSUPPORTED')
    if lt[1] != rt[1]:
        reasons.append('REQUESTED_DEPARTURE_MISMATCH')
    if lt[0] >= lt[1] or rt[0] >= rt[1]:
        reasons.append('NOT_CAPTURED_BEFORE_FUTURE_DEPARTURE')
    if abs((lt[0] - rt[0]).total_seconds()) > 300:
        reasons.append('CAPTURE_TIME_SKEW')
    # Names such as "노원역" alone cannot prove coordinate/entrance/platform equality.
    for key in ('originBoundary', 'destinationBoundary'):
        if left[key] == 'UNKNOWN' or right[key] == 'UNKNOWN' or left[key] != right[key]:
            reasons.append(key.upper() + '_MISMATCH')
    left_walk, right_walk = walking_boundaries(left), walking_boundaries(right)
    if left_walk is None or right_walk is None:
        reasons.append('WALKING_BOUNDARIES_UNCONFIRMED')
    elif left_walk != right_walk:
        reasons.append('WALKING_BOUNDARY_MISMATCH')
    route_keys = ('line', 'from', 'to', 'serviceClass', 'direction')
    route = lambda item: [tuple(ride[key] for key in route_keys) for ride in item['rides']]
    topology = lambda item: [tuple(ride[key] for key in ('line', 'from', 'to', 'direction'))
                             for ride in item['rides']]
    if route(left) != route(right):
        reasons.append('RIDE_ROUTE_MISMATCH')
    elif any(value == 'UNKNOWN' for ride in route(left) for value in ride):
        reasons.append('RIDE_IDENTITY_UNCONFIRMED')
    left_trains, right_trains = train_identities(left), train_identities(right)
    train_reasons = []
    if left_trains is None or right_trains is None:
        train_reasons.append('TRAIN_IDENTITY_UNCONFIRMED')
    elif left_trains != right_trains:
        train_reasons.append('TRAIN_SELECTION_MISMATCH')
    # Whole-trip map agreement can legitimately involve a different train choice.
    # Require a proven same service only when attributing error to that service.
    # Boundary, query time, route and clock precision gates apply to both scopes.
    if scope == 'SAME_SERVICE_TIMING':
        reasons.extend(train_reasons)
    left_clock, right_clock = arrival_clock_bounds(left), arrival_clock_bounds(right)
    if left_clock is None or right_clock is None:
        reasons.append('ARRIVAL_CLOCK_PRECISION_UNCONFIRMED')
    # Retain differences for diagnosis even if boundary matching excludes the sample.
    arrival_delta = (lt[3] - rt[3]).total_seconds()
    diagnostics = []
    if route(left) == route(right):
        for a, b in zip(left['rides'], right['rides']):
            a_board, b_board = instant(a['boardingAt']), instant(b['boardingAt'])
            a_end, b_end = instant(a['arrivalAt']), instant(b['arrivalAt'])
            diagnostics.append({
                'line': a['line'],
                'boardingDeltaSeconds': (a_board - b_board).total_seconds(),
                'alightingDeltaSeconds': (a_end - b_end).total_seconds(),
                'rideDurationDeltaSeconds': ((a_end - a_board) - (b_end - b_board)).total_seconds(),
            })
    comparable = not reasons
    delta_range = None
    assessment, within_two_minutes = 'NOT_COMPARABLE', None
    if left_clock is not None and right_clock is not None:
        lower = arrival_delta + left_clock[0] - right_clock[1]
        upper = arrival_delta + left_clock[1] - right_clock[0]
        delta_range = {'minimum': lower, 'maximum': upper}
        if comparable:
            if lower >= -120 and upper <= 120:
                assessment, within_two_minutes = 'WITHIN_TWO_MINUTES', True
            elif lower > 120 or upper < -120:
                assessment, within_two_minutes = 'OUTSIDE_TWO_MINUTES', False
            else:
                assessment = 'INDETERMINATE_CLOCK_PRECISION'
    # Arithmetic endpoint diagnostic, NOT a causal walking correction. The
    # residual can include unlabelled waiting/rounding or station movement.
    # Preserve exclusion gates above even when this identity sums exactly.
    alighting_delta = (instant(left['rides'][-1]['arrivalAt']) -
                       instant(right['rides'][-1]['arrivalAt'])).total_seconds()
    left_residual = (lt[3] - instant(left['rides'][-1]['arrivalAt'])).total_seconds()
    right_residual = (rt[3] - instant(right['rides'][-1]['arrivalAt'])).total_seconds()
    return {
        'left': left['id'], 'right': right['id'],
        'classification': 'PREDICTION_AGREEMENT_ONLY',
        'comparisonScope': scope,
        'sameTrainComparison': {'confirmed': not train_reasons, 'reasons': train_reasons},
        'comparable': comparable, 'exclusionReasons': reasons,
        'diagnosticArrivalDeltaSeconds': arrival_delta,
        'arrivalDeltaRangeSeconds': delta_range,
        'twoMinuteAssessment': assessment,
        'withinTwoMinutes': within_two_minutes,
        'rideDiagnostics': diagnostics,
        # The partition explains where a difference appears, without lifting
        # the boundary/identity/external-feed gates or altering operational ETA.
        # Unknown/different train classes still block accuracy. Matching visible
        # route topology permits only an arithmetic partition, not train identity.
        'timelineDiagnostic': timeline_diagnostic(left, right) if topology(left) == topology(right) else None,
        'arrivalBoundaryDiagnostic': {
            'classification': 'ARITHMETIC_ONLY_NOT_WALKING_COVERAGE_PROOF',
            'lastAlightingDeltaSeconds': alighting_delta,
            'leftPostAlightingResidualSeconds': left_residual,
            'rightPostAlightingResidualSeconds': right_residual,
            'postAlightingResidualDeltaSeconds': left_residual - right_residual,
            'reconstructedArrivalDeltaSeconds': alighting_delta + left_residual - right_residual,
        },
        # Actual travel observations require a separate protocol; never infer them from maps.
        'realWorldAccuracyVerified': False, 'simulatorE2eVerified': False,
    }


def report(document):
    observations = document['observations']
    if len(observations) < 2:
        raise ValueError('At least two observations are required')
    ids = [item['id'] for item in observations]
    if len(set(ids)) != len(ids):
        raise ValueError('Observation IDs must be unique')
    scope = document.get('comparisonScope', 'SAME_SERVICE_TIMING')
    pairs = [compare(observations[0], item, scope=scope) for item in observations[1:]]
    confirmed = all(item['withinTwoMinutes'] is True for item in pairs)
    disagreement = any(item['withinTwoMinutes'] is False for item in pairs)
    return {
        'classification': 'PREDICTION_COMPARISON',
        'comparisonScope': scope,
        'predictionAgreementVerified': confirmed,
        'result': 'AGREEMENT_CONFIRMED' if confirmed else 'DISAGREEMENT_CONFIRMED' if disagreement else 'INCONCLUSIVE',
        'comparisonCount': len(pairs),
        'comparableCount': sum(item['comparable'] for item in pairs),
        'withinTwoMinutesCount': sum(item['withinTwoMinutes'] is True for item in pairs),
        'outsideTwoMinutesCount': sum(item['withinTwoMinutes'] is False for item in pairs),
        'inconclusiveCount': sum(item['withinTwoMinutes'] is None for item in pairs),
        'realWorldAccuracyVerified': False, 'pairs': pairs,
    }


def agreement_exit_code(result):
    # Exit 2 remains malformed-input; an excluded/ambiguous sample is not a pass.
    return {'AGREEMENT_CONFIRMED': 0, 'DISAGREEMENT_CONFIRMED': 1, 'INCONCLUSIVE': 3}[result['result']]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    parser.add_argument('--export-worker', action='store_true',
                        help='Export one current real Worker prediction, without claiming map or UI verification')
    parser.add_argument('--require-two-minute-agreement', action='store_true',
                        help='Exit 0 only for confirmed prediction agreement, 1 for disagreement, 3 for inconclusive')
    args = parser.parse_args()
    if args.export_worker and args.require_two_minute_agreement:
        parser.error('Export alone cannot verify agreement')
    try:
        document = json.loads(args.evidence.read_text())
        result = worker_prediction(document, args.evidence.name) if args.export_worker else report(document)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.require_two_minute_agreement:
            raise SystemExit(agreement_exit_code(result))
    except (KeyError, TypeError, ValueError) as error:
        parser.exit(2, f'Invalid comparison evidence: {error}\n')

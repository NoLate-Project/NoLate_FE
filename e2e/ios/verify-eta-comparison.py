#!/usr/bin/env python3
"""Compare prediction evidence; map agreement is never observed-trip accuracy.

Read-only CLI. Missing boundaries/time evidence excludes a sample rather than
turning unrelated map durations into a two-minute accuracy success.
"""
import argparse
import datetime as dt
import json
import math
import re
from statistics import median
from pathlib import Path

SEOUL_BUS_LINE = re.compile(r'SEOUL_BUS:[1-9][0-9]{8}')
SEOUL_BUS_STOP = re.compile(r'([1-9][0-9]{8}):([0-9]{5}):([1-9][0-9]{0,2})')


def instant(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('A timezone is required')
    return parsed


def validate(observation, *, require_ride_clocks=True):
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
        mode = ride.get('mode', 'SUBWAY')
        if mode == 'BUS':
            validate_bus_topology(ride)
        elif mode != 'SUBWAY':
            raise ValueError('Unsupported comparison ride mode')
        if boarding_clock_kind(ride) not in ('BOARDING', 'STATION_ARRIVAL_PREDICTION', 'UNKNOWN'):
            raise ValueError('Invalid boarding clock kind')
        if not require_ride_clocks and (ride.get('boardingAt') is None or ride.get('arrivalAt') is None):
            # The browser can show route topology and its destination clock without every alighting clock.
            for field in ('boardingAt', 'arrivalAt'):
                if ride.get(field) is not None:
                    clock = instant(ride[field])
                    if clock < cursor or clock > arrival:
                        raise ValueError('Invalid ride/transfer timeline')
                    cursor = clock
            continue
        boarding, alighting = instant(ride['boardingAt']), instant(ride['arrivalAt'])
        if boarding < cursor or alighting <= boarding or alighting > arrival:
            raise ValueError('Invalid boarding/transfer timeline')
        cursor = alighting
    return observed, requested, departure, arrival


def boarding_clock_kind(ride):
    # Legacy observations recorded a boarding clock. Exported live observations
    # identify the station-arrival clock when the provider basis proves it.
    return ride.get('boardingClockKind', 'UNKNOWN' if ride.get('mode') == 'BUS' else 'BOARDING')


def validate_bus_topology(ride):
    if ride['serviceClass'] not in ('CITY_BUS', 'UNKNOWN'):
        raise ValueError('Unsupported bus service class')
    if ride['line'] != 'UNKNOWN' and not SEOUL_BUS_LINE.fullmatch(ride['line']):
        raise ValueError('Bus line needs the namespaced provider route ID')
    occurrences = []
    for field in ('from', 'to'):
        if ride[field] == 'UNKNOWN':
            continue
        match = SEOUL_BUS_STOP.fullmatch(ride[field])
        if match is None or match[2] == '00000':
            raise ValueError('Bus stop needs the provider station ID, ARS ID and route order')
        occurrences.append((match[1], int(match[3])))
    if len(occurrences) == 2:
        (start, start_order), (end, end_order) = occurrences
        if start == end or start_order >= end_order:
            raise ValueError('Invalid ordered bus stop occurrences')


def worker_boarding_clock_kind(timing):
    basis = timing['basis']
    if basis in ('PLANNED_RIDE_BASELINE', 'PLANNED_RIDE_ALIGHTING_REALTIME'):
        return 'STATION_ARRIVAL_PREDICTION' if timing.get('plannedBoardingIsStationArrival') is True else 'BOARDING'
    if basis in ('FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE', 'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME',
                 'FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING', 'TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE',
                 'TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING', 'PLANNED_RIDE_BOARDING_REALTIME'):
        return 'STATION_ARRIVAL_PREDICTION'
    return 'BOARDING' if basis in ('TIMETABLE', 'TRANSFER_ALIGHTING_REALTIME') else 'UNKNOWN'


def walking_boundaries(observation, *, require_platform_coverage=True):
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
    kinds = ('STREET_COORDINATE', 'STATION_ENTRANCE', 'STATION_PLATFORM', 'BUS_STOP', 'UNKNOWN')
    for i, (item, scope) in enumerate(zip(items, expected)):
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
        ride_ends = []
        if scope != 'ACCESS':
            ride_ends.append((endpoints[0], observation['rides'][i - 1], 'to'))
        if scope != 'EGRESS':
            ride_ends.append((endpoints[1], observation['rides'][i], 'from'))
        needs_platform = False
        for endpoint, ride, field in ride_ends:
            if ride.get('mode') == 'BUS':
                unknown |= endpoint != ('BUS_STOP', ride[field])
            else:
                needs_platform = True
                unknown |= require_platform_coverage and endpoint[0] != 'STATION_PLATFORM'
        if require_platform_coverage:
            unknown |= coverage != ('INCLUDED_TO_PLATFORM' if needs_platform else 'EXCLUDED')
        else:
            unknown |= coverage == 'UNKNOWN'
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
        if ride.get('mode') == 'BUS':
            continue
        item = ride.get('trainIdentity')
        if item is None:
            continue
        if not isinstance(item, dict):
            raise ValueError('Train identity must be an object')
        keys = ('namespace', 'serviceDate', 'number', 'evidence')
        if any(not isinstance(item.get(key), str) or not item[key].strip()
               or item[key] == 'UNKNOWN' for key in keys):
            continue
        date = dt.date.fromisoformat(item['serviceDate'])
        if date.isoformat() != item['serviceDate']:
            raise ValueError('Canonical service date required')
        if ride['line'] == 'UNKNOWN':
            continue
        identities.append((ride['line'], *(item[key] for key in ('namespace', 'serviceDate', 'number'))))
    return identities if len(identities) == len(observation['rides']) else None


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


def coordinate_pair(value):
    if (not isinstance(value, dict)
            or any(type(value.get(k)) not in (int, float) or not math.isfinite(value[k]) for k in ('lat', 'lng'))
            or not -90 <= value['lat'] <= 90 or not -180 <= value['lng'] <= 180):
        return None
    return value['lat'], value['lng']


def requested_pins(value):
    if not isinstance(value, dict):
        return None
    origin = coordinate_pair(value.get('origin'))
    destination = coordinate_pair(value.get('destination'))
    return (origin, destination) if origin and destination else None


def worker_wait_components(segments, departure_at, evidence):
    """Use the same walk and readiness budget as the Worker, without inventing map wait data."""
    access = None
    transfers = []
    previous = None
    walk_seconds = 0
    has_minute_walk = False
    for segment, ride in segments:
        if segment['kind'] == 'WALK':
            seconds = segment.get('durationSeconds')
            has_minute_walk |= seconds is None
            walk_seconds += segment['durationMinutes'] * 60 if seconds is None else seconds
            continue
        boarding = instant(ride['boardingAt'])
        precision = 'INCLUDES_ROUTE_MINUTES' if has_minute_walk else 'ROUTE_SECONDS'
        transfer = segment.get('transferTiming')
        if previous is None:
            gap = (boarding - departure_at).total_seconds() - walk_seconds
            if gap >= 0:
                access = {'walkingSeconds': walk_seconds, 'waitAfterWalkingSeconds': gap,
                          'walkingInputPrecision': precision, 'waitEndsAt': boarding_clock_kind(ride),
                          'evidence': evidence + '#effectiveSnapshot.effectiveTransitRoute'}
        elif transfer is not None:
            alight = instant(previous['arrivalAt'])
            walking, margin = transfer['walkingSeconds'], transfer['requiredMarginSeconds']
            if any(type(value) is not int or value < 0 for value in (walking, margin)):
                raise ValueError('Invalid transfer walk or confidence margin')
            ready = alight + dt.timedelta(seconds=walking)
            wait = boarding - ready
            slack = wait - dt.timedelta(seconds=margin)
            # The Worker publishes Java Duration.seconds, which floors fractional slack.
            whole_slack = slack // dt.timedelta(seconds=1)
            if (walking != walk_seconds or alight != instant(transfer['previousArrivalAt']) or boarding != instant(transfer['boardingAt'])
                    or ready != instant(transfer['physicalReadyAt']) or whole_slack < 0
                    or whole_slack != transfer['remainingSlackSeconds']):
                raise ValueError('Transfer components must match the accepted Worker timeline')
            transfers.append({'beforeRideSequence': segment['sequence'], 'walkingSeconds': walking,
                              'waitAfterWalkingSeconds': wait.total_seconds(), 'requiredMarginSeconds': margin,
                              'remainingSlackSeconds': whole_slack, 'walkingInputPrecision': precision,
                              'waitEndsAt': boarding_clock_kind(ride),
                              'evidence': evidence + f"#segments[{segment['sequence']}].transferTiming"})
        previous = ride
        walk_seconds = 0
        has_minute_walk = False
    return access, transfers


def worker_bus_services(snapshot, route, sequences):
    binding = snapshot.get('lastAcceptedSeoulBusJourney') or {}
    if (route['provider'] != 'odsay' or binding.get('routeIdentity') != route['identity']
            or not binding.get('departureAt') or instant(binding['departureAt']) != instant(route['departureAt'])):
        raise ValueError('Bus route identity and departure must match the accepted Worker binding')
    rides = binding['rides']
    if [item['sequence'] for item in rides] != sequences:
        raise ValueError('Bus segment order must match the accepted Worker binding')
    return {item['sequence']: item['service'] for item in rides}


def worker_bus_ride(segment, service):
    timing = segment['busRidePrediction']
    if timing.get('reportedAlightingAt') is not None:
        raise ValueError('The prediction exporter does not accept past bus arrival reports')
    def stop(field):
        item = service[field]
        return f"{item['stationId']}:{item['arsId']}:{item['order']}"

    # Only the public route and stop occurrence are exported. The internal
    # vehicle correlation does not prove a match against a public map ride.
    return {'mode': 'BUS', 'line': f"SEOUL_BUS:{service['routeId']}", 'from': stop('boarding'), 'to': stop('alighting'),
            'direction': service['direction'], 'serviceClass': 'CITY_BUS', 'boardingAt': timing['boardingAt'],
            'boardingClockKind': 'STATION_ARRIVAL_PREDICTION', 'arrivalAt': timing['alightingAt']}


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
    if any(item['kind'] not in ('WALK', 'SUBWAY', 'BUS') for item in segments):
        raise ValueError('Unsupported Worker segment in prediction export')
    sequences = [item['sequence'] for item in segments]
    if any(type(sequence) is not int or sequence < 0 for sequence in sequences) or sequences != sorted(set(sequences)):
        raise ValueError('Worker segment sequences must be ordered and unique')
    bus_sequences = [item['sequence'] for item in segments if item['kind'] == 'BUS']
    buses = worker_bus_services(snapshot, route, bus_sequences) if bus_sequences else {}
    rides_by_sequence = {}
    for item in segments:
        if item['kind'] == 'BUS':
            rides_by_sequence[item['sequence']] = worker_bus_ride(item, buses[item['sequence']])
        elif item['kind'] == 'SUBWAY':
            timing = item['rideTiming']
            table = timing['timetable']
            rides_by_sequence[item['sequence']] = {'line': table['line'], 'from': table['fromStationCode'],
                'to': table['toStationCode'], 'direction': table['directionCode'],
                'serviceClass': table['serviceClass'], 'boardingAt': timing['predictedBoardingAt'],
                'boardingClockKind': worker_boarding_clock_kind(timing), 'arrivalAt': timing['predictedArrivalAt'],
                'trainIdentity': {'namespace': table['provider'], 'serviceDate': table['serviceDate'],
                                  'number': table['trainNumber'], 'evidence': evidence}}
    walks = [item for item in segments if item['kind'] == 'WALK']
    if not walks or walks[0].get('walkingScope') != 'ACCESS' or walks[-1].get('walkingScope') != 'EGRESS':
        raise ValueError('Explicit endpoint walking evidence required')

    def coordinate_id(value):
        point = coordinate_pair(value)
        return f"coordinate:{point[0]},{point[1]}" if point else 'UNKNOWN'

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
        'walkingBoundaryEvidence': boundary_evidence, 'rides': list(rides_by_sequence.values()),
        'arrivalClockEvidence': {'resolutionSeconds': 1, 'rounding': 'EXACT',
            'evidence': evidence + '#effectiveSnapshot.effectiveTransitRoute.arrivalAt'},
        'protectedAlarmDepartureAt': document.get('recommendedDepartureAt'),
        'realWorldAccuracyVerified': False, 'simulatorE2eVerified': False}
    # These are the pins sent to the Worker, not the walking geometry boundaries.
    pins = document.get('requestedCoordinates')
    if requested_pins(pins):
        observation['requestedCoordinateEvidence'] = {
            'origin': pins['origin'], 'destination': pins['destination'],
            'evidence': evidence + '#requestedCoordinates',
        }
    comparison_departure = document.get('comparisonRequestedDepartureAt')
    if comparison_departure is not None:
        instant(comparison_departure)
        observation['comparisonRequestedDepartureAt'] = comparison_departure
    path_endpoints = []
    for walk in walks:
        geometry = walk.get('walkingGeometry') or {}
        if geometry.get('endpointBasis') != 'PROVIDER_PATH_ENDPOINTS':
            continue
        start, end = geometry.get('from'), geometry.get('to')
        query = geometry.get('providerQueryEndpoints') or {}
        if not coordinate_pair(start) or not coordinate_pair(end):
            raise ValueError('Verified walking path endpoints must have valid coordinates')
        path_endpoints.append({'scope': walk['walkingScope'], 'pathStart': start, 'pathEnd': end,
            'requestedStart': query.get('start'), 'requestedEnd': query.get('end')})
    if path_endpoints:
        observation['providerWalkingPathEndpoints'] = path_endpoints
    access, transfers = worker_wait_components(
        ((item, rides_by_sequence.get(item['sequence'])) for item in segments), instant(route['departureAt']), evidence)
    if access is not None:
        observation['providerAccessComponents'] = access
    if transfers:
        observation['providerTransferComponents'] = transfers
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
        'rideStartClockKinds': [boarding_clock_kind(ride) for ride in rides],
        'accessAndFirstWaitSeconds': (instant(rides[0]['boardingAt']) - departure).total_seconds(),
        'providerAccessComponents': observation.get('providerAccessComponents'),
        'rideSeconds': [(instant(ride['arrivalAt']) - instant(ride['boardingAt'])).total_seconds()
                        for ride in rides],
        'transferAndWaitSeconds': [(instant(b['boardingAt']) - instant(a['arrivalAt'])).total_seconds()
                                   for a, b in zip(rides, rides[1:])],
        'providerTransferComponents': observation.get('providerTransferComponents'),
        'postAlightingResidualSeconds': (arrival - instant(rides[-1]['arrivalAt'])).total_seconds(),
        'requestedToArrivalSeconds': (arrival - requested).total_seconds(),
    }


def fixed_departure_diagnostic(document, evidence):
    """Recover a complete timetable candidate at the original comparison input."""
    accepted = worker_prediction(document, evidence)
    if any(ride.get('mode') == 'BUS' for ride in accepted['rides']):
        raise ValueError('Fixed-departure timetable diagnostics require a subway-only route')
    requested_at = instant(accepted['comparisonRequestedDepartureAt'])
    trace = document['journeyTimingTrace']
    if (trace.get('classification') != 'PASSIVE_REAL_JOURNEY_TIMING_TRACE'
            or trace.get('responseModified') is not False):
        raise ValueError('Unmodified Worker timing trace required')

    route_fields = ('line', 'fromStationCode', 'toStationCode', 'directionCode', 'serviceClass', 'serviceDate')
    accepted_route = [tuple(ride[field] for field in ('line', 'from', 'to', 'direction', 'serviceClass'))
                      + (ride['trainIdentity']['serviceDate'],) for ride in accepted['rides']]
    candidates = []
    for index, event in enumerate(trace['events']):
        if (event['method'] != 'enrich' or event['provider'] != document['journeyProvider']
                or instant(event['requestedDepartureAt']) != requested_at
                or instant(event['departureAt']) != requested_at):
            continue
        legs = [leg for leg in event['legs'] if leg['mode'] != 'WALK']
        if not all(leg['mode'] == 'SUBWAY' and leg['timingBasis'] == 'TIMETABLE'
                   and leg.get('timetable') for leg in legs):
            continue
        tables = [leg['timetable'] for leg in legs]
        if [tuple(table[field] for field in route_fields) for table in tables] != accepted_route:
            continue
        walks = [leg for leg in event['legs'] if leg['mode'] == 'WALK']
        scopes = ['ACCESS'] + ['TRANSFER'] * (len(tables) - 1) + ['EGRESS']
        if ([walk['walkingScope'] for walk in walks] != scopes
                or any(type(walk.get('movementSeconds')) is not int or walk['movementSeconds'] < 0
                       for walk in walks)):
            continue
        destination = instant(event['arrivalAt'])
        cursor = requested_at
        rides = []
        for table in tables:
            boarding, arrival = instant(table['boardingAt']), instant(table['arrivalAt'])
            if not cursor <= boarding < arrival <= destination:
                raise ValueError('Invalid fixed-departure timetable candidate timeline')
            rides.append({field: table[field] for field in (*route_fields, 'trainNumber', 'boardingAt', 'arrivalAt')})
            cursor = arrival
        candidates.append({
            'evidence': evidence + f'#journeyTimingTrace.events[{index}]',
            'arrivalAt': event['arrivalAt'],
            'rides': rides,
            'walkingSeconds': [walk['movementSeconds'] for walk in walks],
            'lastStationArrivalDeltaSeconds': (cursor - instant(accepted['rides'][-1]['arrivalAt'])).total_seconds(),
            'destinationArrivalDeltaSeconds': (destination - instant(accepted['arrivalAt'])).total_seconds(),
        })
    return {
        'classification': 'FIXED_DEPARTURE_TIMETABLE_CANDIDATES_DIAGNOSTIC_ONLY',
        'requestedDepartureAt': accepted['comparisonRequestedDepartureAt'],
        'acceptedDepartureAt': accepted['departureAt'],
        'acceptedArrivalAt': accepted['arrivalAt'],
        'candidates': candidates,
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


def displayed_arrival(item):
    evidence = item.get('displayedArrivalEvidence')
    if not isinstance(evidence, dict) or evidence.get('scope') != 'REQUESTED_DESTINATION':
        return None
    if not isinstance(evidence.get('evidence'), str) or not evidence['evidence'].strip():
        return None
    observed_clock = instant(evidence['arrivalAt'])
    if observed_clock.second or observed_clock.microsecond:
        raise ValueError('Displayed arrival must be a minute clock')
    if abs((observed_clock - instant(item['arrivalAt'])).total_seconds()) >= 60:
        raise ValueError('Displayed clock must describe this prediction')
    return observed_clock


def display_comparison(left, right, lt, rt, same_topology, common_reasons, *, use_prediction_arrival=False):
    """Compare destination clocks without claiming walking coverage or train ID."""
    reasons = list(common_reasons)
    def evidenced_pins(item):
        pins = item.get('requestedCoordinateEvidence')
        if not isinstance(pins, dict) or not isinstance(pins.get('evidence'), str) or not pins['evidence'].strip():
            return None
        return requested_pins(pins)

    left_pins, right_pins = evidenced_pins(left), evidenced_pins(right)
    if left_pins is None or right_pins is None:
        reasons.append('DISPLAY_QUERY_COORDINATES_UNCONFIRMED')
    elif left_pins != right_pins:
        reasons.append('DISPLAY_QUERY_COORDINATES_MISMATCH')
    if lt[2] != rt[1]:
        reasons.append('CALCULATED_DEPARTURE_DIFFERS_FROM_COMPARISON_INPUT')
    if not same_topology:
        reasons.append('VISIBLE_ROUTE_TOPOLOGY_UNCONFIRMED')
    left_displayed = lt[3] if use_prediction_arrival else displayed_arrival(left)
    right_displayed = displayed_arrival(right)
    if left_displayed is None or right_displayed is None:
        reasons.append('DISPLAYED_DESTINATION_CLOCK_UNCONFIRMED')
    difference = None
    if not reasons:
        minutes = (left_displayed - right_displayed).total_seconds() / 60
        difference = minutes if use_prediction_arrival else int(minutes)
    return {
        'comparable': not reasons,
        'exclusionReasons': reasons,
        'leftMinusRightDisplayedMinutes': difference,
    }


def comparison_input_reasons(left, right, lt, rt):
    reasons = []
    if left['mocked'] or right['mocked']:
        reasons.append('MOCK_FEED')
    if left['queryMode'] != 'DEPART_AT' or right['queryMode'] != 'DEPART_AT':
        reasons.append('QUERY_MODE_UNSUPPORTED')
    if lt[1] != rt[1]:
        reasons.append('REQUESTED_DEPARTURE_MISMATCH')
    # A later evaluation can move the model's route start. Its export must not
    # silently turn that new start into the original map-comparison input.
    if any(item.get('comparisonRequestedDepartureAt') is not None and
           instant(item['comparisonRequestedDepartureAt']) != timings[1]
           for item, timings in ((left, lt), (right, rt))):
        reasons.append('ORIGINAL_COMPARISON_DEPARTURE_MISMATCH')
    if lt[0] >= lt[1] or rt[0] >= rt[1]:
        reasons.append('NOT_CAPTURED_BEFORE_FUTURE_DEPARTURE')
    if abs((lt[0] - rt[0]).total_seconds()) > 300:
        reasons.append('CAPTURE_TIME_SKEW')
    return reasons


def topology(item):
    return [(ride.get('mode', 'SUBWAY'), *(ride[key] for key in ('line', 'from', 'to', 'direction')))
            for ride in item['rides']]


def compare(left, right, scope='SAME_SERVICE_TIMING'):
    if scope not in ('SAME_SERVICE_TIMING', 'DOOR_TO_DOOR_PREDICTION'):
        raise ValueError('Explicit supported comparison scope required')
    lt, rt = validate(left), validate(right)
    common_reasons = comparison_input_reasons(left, right, lt, rt)
    reasons = common_reasons.copy()
    # Names such as "노원역" alone cannot prove coordinate/entrance/platform equality.
    for key in ('originBoundary', 'destinationBoundary'):
        if left[key] == 'UNKNOWN' or right[key] == 'UNKNOWN' or left[key] != right[key]:
            reasons.append(key.upper() + '_MISMATCH')
    left_walk, right_walk = walking_boundaries(left), walking_boundaries(right)
    if left_walk is None or right_walk is None:
        reasons.append('WALKING_BOUNDARIES_UNCONFIRMED')
    elif left_walk != right_walk:
        reasons.append('WALKING_BOUNDARY_MISMATCH')
    route = lambda item: [(*legs, ride['serviceClass']) for legs, ride in zip(topology(item), item['rides'])]
    same_topology = topology(left) == topology(right)
    if route(left) != route(right):
        reasons.append('RIDE_ROUTE_MISMATCH')
    elif any(value == 'UNKNOWN' for ride in route(left) for value in ride):
        reasons.append('RIDE_IDENTITY_UNCONFIRMED')
    left_trains, right_trains = train_identities(left), train_identities(right)
    train_reasons = []
    if any(ride.get('mode') == 'BUS' for item in (left, right) for ride in item['rides']):
        train_reasons.append('BUS_VEHICLE_IDENTITY_UNCONFIRMED')
    elif left_trains is None or right_trains is None:
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
            a_kind, b_kind = boarding_clock_kind(a), boarding_clock_kind(b)
            same_start_clock = a_kind == b_kind and a_kind != 'UNKNOWN'
            diagnostics.append({
                'line': a['line'],
                'leftBoardingClockKind': a_kind,
                'rightBoardingClockKind': b_kind,
                'boardingDeltaSeconds': (a_board - b_board).total_seconds() if same_start_clock and a_kind == 'BOARDING' else None,
                'stationArrivalPredictionDeltaSeconds': (a_board - b_board).total_seconds()
                    if same_start_clock and a_kind == 'STATION_ARRIVAL_PREDICTION' else None,
                'alightingDeltaSeconds': (a_end - b_end).total_seconds(),
                'rideDurationDeltaSeconds': ((a_end - a_board) - (b_end - b_board)).total_seconds()
                    if same_start_clock and a_kind == 'BOARDING' else None,
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
        'displayedDestinationComparison': display_comparison(
            left, right, lt, rt, same_topology and
            all(value != 'UNKNOWN' for ride in topology(left) for value in ride), common_reasons),
        'rideDiagnostics': diagnostics,
        # The partition explains where a difference appears, without lifting
        # the boundary/identity/external-feed gates or altering operational ETA.
        # Unknown/different train classes still block accuracy. Matching visible
        # route topology permits only an arithmetic partition, not train identity.
        'timelineDiagnostic': timeline_diagnostic(left, right) if same_topology else None,
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
        'displayedDestinationComparableCount': sum(item['displayedDestinationComparison']['comparable'] for item in pairs),
        'realWorldAccuracyVerified': False, 'pairs': pairs,
    }


def whole_journey_walking_scopes(observation):
    """Publicly evidenced inclusion of access, each transfer, and egress.

    This describes the whole journey between the requested pins. It makes no
    claim about how a provider allocates station-interior time between legs.
    """
    items = observation.get('walkingCoverageEvidence')
    expected = ['ACCESS'] + ['TRANSFER'] * (len(observation['rides']) - 1) + ['EGRESS']
    if not isinstance(items, list) or len(items) != len(expected):
        return None
    for item, scope in zip(items, expected):
        if (not isinstance(item, dict) or item.get('scope') != scope or item.get('included') is not True
                or not isinstance(item.get('evidence'), str) or not item['evidence'].strip()):
            return None
    return tuple(expected)


def paired_route_clocks(prediction, reference):
    """Localize a displayed gap only between events actually published by the map."""
    rows = []
    previous_key, previous_delta = None, None

    def add(key, app_value, map_value):
        nonlocal previous_key, previous_delta
        app_at = instant(app_value).replace(second=0, microsecond=0) if app_value else None
        map_at = instant(map_value) if map_value else None
        if map_at is not None and (map_at.second or map_at.microsecond):
            raise ValueError('A published minute clock cannot include hidden seconds')
        delta = int((app_at - map_at).total_seconds() / 60) if app_at and map_at else None
        rows.append({'event': key, 'appMinute': app_at.isoformat() if app_at else None,
                     'mapMinute': map_at.isoformat() if map_at else None, 'appMinusMapMinutes': delta,
                     'fromEvent': previous_key if delta is not None else None,
                     'changeInGapMinutes': delta - previous_delta if delta is not None and previous_delta is not None else None})
        if delta is not None:
            previous_key, previous_delta = key, delta

    query_minute = instant(reference['requestedDepartureAt']).replace(second=0, microsecond=0).isoformat()
    add('QUERY_DEPARTURE', prediction['requestedDepartureAt'], query_minute)
    def published(item, field):
        citations = item.get('publishedClockEvidence')
        evidence = citations.get(field) if isinstance(citations, dict) else None
        return item.get(field) if isinstance(evidence, str) and evidence.strip() else None

    add('ROUTE_DEPARTURE', prediction['departureAt'], published(reference, 'departureAt'))
    for idx, (app, public) in enumerate(zip(prediction['rides'], reference['rides']), 1):
        for event, field in (('BOARDING', 'boardingAt'), ('ALIGHTING', 'arrivalAt')):
            # A duration shown in the UI cannot establish an unpublished station clock.
            same_event = event != 'BOARDING' or boarding_clock_kind(app) == boarding_clock_kind(public) == 'BOARDING'
            add(f'RIDE_{idx}_{event}', app.get(field) if same_event else None, published(public, field))
    add('DESTINATION', prediction['arrivalAt'], reference['displayedArrivalEvidence']['arrivalAt'])
    return rows


def paired_map_report(document):
    cases = document['samples']
    walking_scope = document.get('walkingComparisonScope', 'IDENTICAL_BOUNDARIES')
    if walking_scope not in ('IDENTICAL_BOUNDARIES', 'WHOLE_JOURNEY'):
        raise ValueError('Unsupported walking comparison scope')
    walking_evidence = whole_journey_walking_scopes if walking_scope == 'WHOLE_JOURNEY' else (
        lambda item: walking_boundaries(item, require_platform_coverage=False))
    large_error_minutes = document.get('largeErrorMinutes', 5)
    if type(large_error_minutes) is not int or large_error_minutes < 1:
        raise ValueError('Large error threshold must be a positive number of minutes')
    rows = []
    sample_ids = set()
    map_ids = set()
    for case in cases:
        sample_id = case['id']
        reference = case['naver']
        if sample_id in sample_ids or reference['id'] in map_ids:
            raise ValueError('Each case needs a distinct ID and Naver observation')
        sample_ids.add(sample_id)
        map_ids.add(reference['id'])
        if reference['kind'] != 'MAP_PREDICTION':
            raise ValueError('Naver reference must be a map prediction')
        reference_times = validate(reference, require_ride_clocks=False)
        map_walk = walking_evidence(reference)
        row = {'id': sample_id, 'naverObservationId': reference['id']}
        for phase in ('before', 'after'):
            prediction = case[phase]
            if prediction is None:
                row[phase] = {'exclusionReasons': ['APP_PREDICTION_MISSING'], 'appMinusNaverMinutes': None,
                              'routeClockComparison': None, 'routeClockDurationDifferenceMinutes': None}
                continue
            if prediction['kind'] != 'APP_PREDICTION':
                raise ValueError('Both phases must be app predictions')
            times = validate(prediction, require_ride_clocks=False)
            route = topology(prediction)
            same_topology = route == topology(reference) and all('UNKNOWN' not in ride for ride in route)
            display = display_comparison(prediction, reference, times, reference_times, same_topology,
                                         comparison_input_reasons(prediction, reference, times, reference_times),
                                         use_prediction_arrival=True)
            reasons = list(display['exclusionReasons'])
            app_walk = walking_evidence(prediction)
            if app_walk is None or map_walk is None:
                reasons.append('WALKING_COVERAGE_UNCONFIRMED' if walking_scope == 'WHOLE_JOURNEY'
                               else 'WALKING_BOUNDARIES_UNCONFIRMED')
            elif app_walk != map_walk:
                reasons.append('WALKING_BOUNDARY_MISMATCH')
            clocks = None if reasons else paired_route_clocks(prediction, reference)
            duration_difference = None
            if clocks:
                departure_gap = next(c['appMinusMapMinutes'] for c in clocks if c['event'] == 'ROUTE_DEPARTURE')
                if departure_gap is not None:
                    # Arrival gap = door departure gap + trip duration gap, all at displayed minute precision.
                    duration_difference = clocks[-1]['appMinusMapMinutes'] - departure_gap
            row[phase] = {'exclusionReasons': reasons, 'appMinusNaverMinutes':
                          None if reasons else display['leftMinusRightDisplayedMinutes'],
                          'routeClockComparison': clocks, 'routeClockDurationDifferenceMinutes': duration_difference}
        rows.append(row)

    comparable = [row for row in rows if all(row[phase]['appMinusNaverMinutes'] is not None
                                             for phase in ('before', 'after'))]
    # Repeat captures of one future route query do not add trips to the distribution.
    references = {case['id']: case['naver'] for case in cases}
    distinct, repeated = {}, []
    for row in sorted(comparable, key=lambda r: (instant(references[r['id']]['observedAt']), r['id'])):
        public = references[row['id']]
        key = (requested_pins(public['requestedCoordinateEvidence']), instant(public['requestedDepartureAt']),
               tuple(topology(public)))
        if key in distinct:
            repeated.append(row['id'])
        else:
            distinct[key] = row
    distribution = {}
    for phase in ('before', 'after'):
        errors = sorted(abs(row[phase]['routeClockComparison'][-1]['appMinusMapMinutes']) for row in distinct.values())
        distribution[phase] = {'medianAbsoluteMinutes': median(errors) if errors else None,
                               'p90AbsoluteMinutes': errors[math.ceil(len(errors) * .9) - 1] if errors else None,
                               'maximumAbsoluteMinutes': max(errors, default=None)}
    summary = {}
    for phase in ('before', 'after'):
        magnitudes = [abs(row[phase]['appMinusNaverMinutes']) for row in comparable]
        summary[phase] = {
            'meanAbsoluteErrorMinutes': sum(magnitudes) / len(magnitudes) if magnitudes else None,
            'largeErrorCount': sum(value >= large_error_minutes for value in magnitudes) if magnitudes else None,
            'withinTwoMinutesCount': sum(value <= 2 for value in magnitudes) if magnitudes else None,
        }
    return {'classification': 'PAIRED_NAVER_DISPLAY_COMPARISON', 'candidateCount': len(rows),
            'comparableCount': len(comparable), 'largeErrorMinutes': large_error_minutes,
            'walkingComparisonScope': walking_scope,
            'destinationMinuteDistribution': {'distinctRouteQueryCount': len(distinct), 'repeatCaptureIds': repeated,
                                              'percentileMethod': 'NEAREST_RANK', **distribution},
            'stationInteriorAllocationVerified': False,
            'realWorldAccuracyVerified': False,
            **summary, 'samples': rows}


def agreement_exit_code(result):
    # Exit 2 remains malformed-input; an excluded/ambiguous sample is not a pass.
    return {'AGREEMENT_CONFIRMED': 0, 'DISAGREEMENT_CONFIRMED': 1, 'INCONCLUSIVE': 3}[result['result']]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    exports = parser.add_mutually_exclusive_group()
    exports.add_argument('--export-worker', action='store_true',
                         help='Export one current real Worker prediction, without claiming map or UI verification')
    exports.add_argument('--diagnose-fixed-departure', action='store_true',
                         help='Show recorded timetable candidates at the original requested departure')
    exports.add_argument('--paired-naver', action='store_true',
                         help='Summarize before/after destination clocks against the same Naver observation')
    parser.add_argument('--require-two-minute-agreement', action='store_true',
                        help='Exit 0 only for confirmed prediction agreement, 1 for disagreement, 3 for inconclusive')
    args = parser.parse_args()
    if (args.export_worker or args.diagnose_fixed_departure or args.paired_naver) and args.require_two_minute_agreement:
        parser.error('The two-minute agreement exit code is only supported for the standard comparison')
    try:
        document = json.loads(args.evidence.read_text())
        if args.export_worker:
            result = worker_prediction(document, args.evidence.name)
        elif args.diagnose_fixed_departure:
            result = fixed_departure_diagnostic(document, args.evidence.name)
        elif args.paired_naver:
            result = paired_map_report(document)
        else:
            result = report(document)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.require_two_minute_agreement:
            raise SystemExit(agreement_exit_code(result))
    except (KeyError, TypeError, ValueError) as error:
        parser.exit(2, f'Invalid comparison evidence: {error}\n')

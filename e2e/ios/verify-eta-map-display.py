#!/usr/bin/env python3
"""Compare visible door-to-door predictions, not hidden train clocks or actual trip accuracy.

Keep the stricter same-service/platform/clock verifier separate. Different walking
models are a diagnostic here, not a reason to silently skip the visible ETA gap.
"""
import argparse
import datetime as dt
import importlib.util
import json
import math
import re
from pathlib import Path
from urllib.parse import urlsplit

comparison_spec = importlib.util.spec_from_file_location('eta_comparison', Path(__file__).with_name('verify-eta-comparison.py'))
comparison = importlib.util.module_from_spec(comparison_spec)
comparison_spec.loader.exec_module(comparison)
SEOUL = dt.timezone(dt.timedelta(hours=9))
DISPLAY_DURATION = r'(?:\d+시간(?:\s*\d+분)?|\d+분)'
ROUTE_COMPONENT = re.compile(rf'(도보|[^\s]+지하철|[^\s]+버스)\s+({DISPLAY_DURATION})(?!\S)')
WEB_MERCATOR_RADIUS_METERS = 6378137


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


def compare(worker, public, map_display, snapshot=None):
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
            or public.get('failureReason') is not None or public.get('confidence') not in ('MEDIUM', 'HIGH')
            or public.get('scheduleId') != worker['scheduleId']
            or instant(public['evaluatedAt']) != instant(worker['evaluatedAt'])
            or public.get('transitTimingBasis') != worker['effectiveSnapshot'].get('transitTimingBasis')
            or instant(worker['predictedArrivalAt']) != instant(route['arrivalAt'])
            or public.get('effectiveTransitRoute') != route
            or public.get('predictedArrivalAt') != route['arrivalAt']):
        raise ValueError('The app API must still expose the same accepted prediction')
    return compare_inputs(worker, route, map_display, snapshot)


def compare_timetable_preview(worker, public, map_display, map_snapshot=None):
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
            or not reason.startswith(('TRANSIT_TRAIN_NOT_YET_OBSERVED:', 'TRANSIT_ARRIVAL_SOURCE_STALE:'))
            or worker.get('predictedArrivalAt') is not None
            or public.get('source') != worker['source'] or public.get('stale') is not True
            or public.get('failureReason') != reason or public.get('scheduleId') != worker['scheduleId']
            or public.get('predictedArrivalAt') is not None or public.get('effectiveTransitRoute') is not None
            or public.get('firstBoardingObservation') is not None or public.get('confidence') != 'LOW'
            or public.get('futureTimetablePrediction') != route or not route):
        raise ValueError('Only the separate future timetable preview is eligible')
    window = public.get('_isolationReadWindow') or {}
    started, finished = instant(window['startedAt']), instant(window['finishedAt'])
    if not instant(worker['evaluatedAt']) <= started <= finished < instant(route['departureAt']) or instant(route['arrivalAt']) > instant(worker['targetArrivalAt']):
        raise ValueError('The app must still expose this future, on-time timetable preview')
    for segment in route['segments']:
        if segment['kind'] == 'WALK':
            continue
        if segment['kind'] != 'SUBWAY':
            raise ValueError('A timetable-only preview must contain subway rides')
        timing = segment['rideTiming']
        table = timing['timetable']
        if (timing['basis'] != 'TIMETABLE' or table['provider'] != 'seoul-timetable'
                or timing['predictedBoardingAt'] != table['boardingAt']
                or timing['predictedArrivalAt'] != table['arrivalAt']):
            raise ValueError('Do not mix real-time ride evidence into timetable-only comparison')
    result = compare_inputs(worker, route, map_display, map_snapshot)
    result.update(classification='TIMETABLE_ONLY_FUTURE_DISPLAY_DIAGNOSTIC',
                  result='TIMETABLE_DISPLAY_COMPARED' if result['result'] == 'DISPLAY_COMPARED' else result['result'],
                  acceptedRealtimeEtaVerified=False, futureTimetableDisplayOnly=True)
    return result


def visible_route_components(map_display):
    """Read the selected card's component durations. Unpublished gaps stay unknown."""
    card = map_display.get('routeEvidenceLabel') or ''
    def minutes(value):
        parts = dict((unit, int(number)) for number, unit in re.findall(r'(\d+)(시간|분)', value))
        return 60 * parts.get('시간', 0) + parts.get('분', 0)

    components = ROUTE_COMPONENT.findall(card)
    ride_modes = ['SUBWAY' if label.endswith('지하철') else 'BUS' for label, _ in components if label != '도보']
    if ride_modes != [ride['kind'] for ride in map_display['rides']]:
        return None
    walks = [None] * (len(ride_modes) + 1)
    rides = []
    for label, duration in components:
        if label == '도보':
            walks[len(rides)] = (walks[len(rides)] or 0) + minutes(duration)
        else:
            rides.append(minutes(duration))
    header = re.match(rf'(?:최적\s+)?({DISPLAY_DURATION})(?!\S)', card)
    total = minutes(header[1]) if header else None
    return {'visibleTotalMinutes': total, 'visibleRideMinutes': rides,
            'visibleWalkingMinutes': {'access': walks[0], 'transfers': walks[1:-1], 'egress': walks[-1]},
            'unallocatedDisplayedMinutes': total - sum(rides) - sum(walks)
            if total is not None and all(walk is not None for walk in walks) else None}


def compare_inputs(worker, route, map_display, snapshot=None):
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
    bus_legs = [leg for leg in rides if leg['kind'] == 'BUS']
    services = comparison.worker_bus_services(worker['effectiveSnapshot'], route, [leg['sequence'] for leg in bus_legs]) if bus_legs else {}
    app_buses = []
    app_trains = []
    topology = []
    for leg in rides:
        kind = leg['kind']
        if kind == 'SUBWAY':
            timing = leg['rideTiming']
            line = timing['timetable']['line']
            app_trains.append({'number': timing['timetable']['trainNumber'], 'boardingAt': timing['predictedBoardingAt'],
                               'arrivalAt': timing['predictedArrivalAt']})
        elif kind == 'BUS':
            line = leg['lineName']
            service = services[leg['sequence']]
            bus = comparison.worker_bus_ride(leg, service)
            comparison.validate_bus_topology(bus)
            app_buses.append({'line': line, 'routeId': service['routeId'], 'fromName': leg['fromName'], 'toName': leg['toName'],
                              'fromArs': service['boarding']['arsId'], 'toArs': service['alighting']['arsId'],
                              'boardingStopArrivalForecastAt': bus['boardingAt'], 'alightingStopArrivalForecastAt': bus['arrivalAt']})
        else:
            raise ValueError('Unsupported Worker ride type in map display comparison')
        topology.append((kind, line, leg['fromName'], leg['toName']))
    map_rides = map_display['rides']
    map_topology = [(s['kind'], s['line'], s['fromName'], s['toName']) for s in map_rides]
    map_buses = [ride for ride in map_rides if ride['kind'] == 'BUS']
    contains_bus = bool(bus_legs or map_buses)
    cursor = map_departure
    for ride in map_rides:
        if contains_bus and ride.get('displayedBoardingAt') is None:
            continue  # Public route summaries do not always publish every stop clock.
        boarding = instant(ride['displayedBoardingAt'])
        if boarding < cursor or boarding >= map_arrival or boarding.second or boarding.microsecond:
            raise ValueError('Ordered visible minute boarding clocks required')
        cursor = boarding
    exclusions = []
    if app_departure != map_query:
        exclusions.append('COMPUTED_DEPARTURE_MISMATCH')
    original_departure = worker.get('comparisonRequestedDepartureAt')
    if original_departure and instant(original_departure) != map_query:
        exclusions.append('ORIGINAL_COMPARISON_DEPARTURE_MISMATCH')
    if app_observed >= app_departure:
        exclusions.append('APP_NOT_CAPTURED_BEFORE_FUTURE_DEPARTURE')
    if abs((app_observed - map_observed).total_seconds()) > 300:
        exclusions.append('CAPTURE_TIME_SKEW')
    if coordinates(worker['requestedCoordinates']) != coordinates(map_display['requestedCoordinates']):
        exclusions.append('REQUEST_COORDINATES_MISMATCH')
    public_points = public_point_alignment(map_display, snapshot)
    if public_points == 'MISMATCH':
        exclusions.append('PUBLIC_MAP_ADDRESS_POINTS_MISMATCH')
    if topology != map_topology:
        exclusions.append('VISIBLE_ROUTE_MISMATCH')
    ars_matches = [shown.get(field) == saved[field] if shown.get(field) else None
                   for saved, shown in zip(app_buses, map_buses) for field in ('fromArs', 'toArs')]
    if topology == map_topology and False in ars_matches:
        exclusions.append('VISIBLE_BUS_STOP_ARS_MISMATCH')
    delta = (instant(route['arrivalAt']) - map_arrival).total_seconds()
    comparable = not exclusions
    result = {
        'classification': 'DISPLAYED_DOOR_TO_DOOR_PREDICTION_DIAGNOSTIC',
        'result': 'DISPLAY_COMPARED' if comparable else 'INPUTS_NOT_MATCHED',
        'exclusionReasons': exclusions,
        'requestedDepartureAt': map_display['requestedDepartureAt'],
        'appComputedDepartureAt': route['departureAt'],
        'protectedAlarmDepartureAt': worker['recommendedDepartureAt'],
        'appArrivalAt': route['arrivalAt'], 'naverDisplayedArrivalAt': map_display['displayedArrivalAt'],
        'nominalArrivalDeltaSeconds': delta,
        'nominalDisplayGapWithinTwoMinutes': abs(delta) <= 120 if comparable else None,
        'appTrains': app_trains,
        'appBusRides': app_buses,
        'visibleBusStopArsVerified': bool(app_buses and not exclusions and all(ars_matches)),
        'busStopOccurrencesVerified': False, 'sameBusVehicleIdentityVerified': False,
        'naverVisibleBoardingClocks': [s.get('displayedBoardingAt') for s in map_rides],
        'publicMapAddressPoints': public_points,
        'appWalkingSeconds': [s['durationSeconds'] if s.get('durationSeconds') is not None else s['durationMinutes'] * 60
                              for s in route['segments'] if s['kind'] == 'WALK'],
        # This diagnostic compares user-visible products; it cannot prove these unknowns.
        'mapMinuteClockRounding': 'UNKNOWN', 'sameTrainIdentityVerified': False,
        'stationPlatformWalkingCoverageVerified': False,
        'mapAccuracyWithinTwoMinutesVerified': False, 'actualTripAccuracyVerified': False,
        'snapshotEvidence': map_display['snapshotEvidence'],
    }
    components = visible_route_components(map_display) if map_display.get('routeEvidenceLabel') else None
    if contains_bus or components:
        result['naverVisibleComponents'] = components
    if not contains_bus and topology == map_topology:
        details_verified = rail_detail_matches(map_display, snapshot)
        result['publicRailTimingEvidence'] = rail_display_evidence(
            app_trains, map_rides, components, public_points, comparable, details_verified,
            app_departure == map_departure)
    if bus_legs:
        app = comparison.worker_prediction(worker, 'effectiveSnapshot.effectiveTransitRoute')
        result['appTimingComponents'] = comparison.timeline_budget(app)
    return result


def public_point_alignment(map_display, snapshot):
    """Compare the numeric pins exposed in the public route address to the declared request.

    The browser can expose opaque place identifiers. Their coordinates are left unverified.
    """
    page_urls = re.findall(r'^- Page URL: (\S+)$', snapshot or '', re.MULTILINE)
    if len(page_urls) != 1:
        return 'UNVERIFIED'
    url = urlsplit(page_urls[0])
    path = url.path.split('/')
    if (url.scheme != 'https' or url.netloc != 'map.naver.com' or path[:3] != ['', 'p', 'directions'] or
            path[5:7] != ['-', 'transit'] or len(path) not in (7, 8) or (len(path) == 8 and not path[7].isdecimal())):
        return 'UNVERIFIED'
    for point, (lat, lng) in zip(path[3:5], coordinates(map_display['requestedCoordinates'])):
        fields = point.split(',')
        if len(fields) != 5 or not fields[2] or any(fields[3:]):
            return 'UNVERIFIED'  # A named POI, station object, or waypoint can snap to a different boundary.
        try:
            x, y = map(float, fields[:2])
        except ValueError:
            return 'UNVERIFIED'
        if abs(lat) >= 90 or not math.isfinite(x) or not math.isfinite(y):
            return 'MISMATCH'
        expected_x = WEB_MERCATOR_RADIUS_METERS * math.radians(lng)
        expected_y = WEB_MERCATOR_RADIUS_METERS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        # Allow numeric coordinate serialization differences, up to one millimetre in the projection.
        if not (math.isclose(x, expected_x, rel_tol=0, abs_tol=.001) and
                math.isclose(y, expected_y, rel_tol=0, abs_tol=.001)):
            return 'MISMATCH'
    return 'MATCHED_PUBLIC_NUMERIC_POINTS'


def rail_detail_matches(map_display, snapshot):
    if not snapshot or not map_display.get('routeEvidenceLabel'):
        return False
    rows = [match.groups() for match in re.finditer(r'^\s*-\s+\'?button "([^"]+)"(.*)$', snapshot, re.MULTILINE)]
    cards = [i for i, (label, _) in enumerate(rows) if label.endswith(' 상세보기')]
    if [rows[i][0] for i in cards if '[expanded]' in rows[i][1]] != [map_display['routeEvidenceLabel']]:
        return False
    view = iter(label for label, _ in rows[cards[-1] + 1:])
    for ride in map_display['rides']:
        line = re.fullmatch(r'LINE_([1-9])', ride['line'])
        if line is None or not ride.get('visibleTerminal'):
            return False
        boarding = rf'{line[1]}호선\s*{re.escape(ride["fromName"])}(?:역)?\s+승차(?:\s|$)'
        alighting = rf'(?<!\S){re.escape(ride["toName"])}(?:역)?\s+하차(?:\s|$)'
        boarding_clock = instant(ride['displayedBoardingAt']).astimezone(SEOUL).strftime('%H:%M') + ride['visibleTerminal']
        from_label = next((label for label in view if re.search(r'\s승차(?:\s|$)', label)), '')
        if not re.search(boarding, from_label) or boarding_clock not in from_label:
            return False
        to_label = next((label for label in view if re.search(r'\s하차(?:\s|$)', label)), '')
        if not re.search(alighting, to_label):
            return False
    return True


def rail_display_evidence(app_trains, map_rides, components, public_points, comparable, details_verified, same_suggested_departure):
    clocks = []
    for app, shown in zip(app_trains, map_rides):
        boarding = instant(app['boardingAt'])
        naver_minute = instant(shown['displayedBoardingAt'])
        clocks.append({'appBoardingAt': app['boardingAt'], 'naverVisibleBoardingAt': shown['displayedBoardingAt'],
                       'appClockMinusMapDisplayedSeconds': (boarding - naver_minute).total_seconds(),
                       'boardingFallsInSameDisplayedMinute': boarding.replace(second=0, microsecond=0) == naver_minute})
    walking = (components or {}).get('visibleWalkingMinutes') or {}
    all_walks_visible = bool(walking and None not in [walking['access'], *walking['transfers'], walking['egress']])
    reasons = []
    if not comparable:
        reasons.append('DISPLAY_INPUTS_NOT_MATCHED')
    if public_points != 'MATCHED_PUBLIC_NUMERIC_POINTS':
        reasons.append('PUBLIC_NUMERIC_POINTS_UNVERIFIED')
    if not details_verified:
        reasons.append('SELECTED_PUBLIC_RAIL_DETAIL_UNVERIFIED')
    if not same_suggested_departure:
        reasons.append('DISPLAYED_DOOR_DEPARTURE_DIFFERS')
    if not all_walks_visible:
        reasons.append('DOOR_OR_TRANSFER_WALKING_NOT_FULLY_DISPLAYED')
    if not all(clock['boardingFallsInSameDisplayedMinute'] for clock in clocks):
        reasons.append('RIDE_BOARDING_CLOCKS_DIFFER')
    return {'boardingClockComparisons': clocks, 'selectedPublicRideDetailVerified': details_verified,
            'allWalkingStagesDisplayed': all_walks_visible,
            'sameVisibleInputsAndRideMinutes': not reasons, 'exclusionReasons': reasons}


def matches_full_visible_label(snapshot, label):
    label = ' '.join(label.split())
    return any(label == ' '.join(line.split()) or f'"{label}"' in ' '.join(line.split())
               for line in snapshot.splitlines())


def verify_bus_route_snapshot(map_display, snapshot, arrival):
    chosen = map_display.get('routeEvidenceLabel') or ''
    if not chosen or not matches_full_visible_label(snapshot, chosen):
        raise ValueError('Capture the exact public mixed-route summary label')
    chosen = ' '.join(chosen.split())
    period = '오전' if arrival.hour < 12 else '오후'
    clocks = (f'도착 {arrival:%H:%M}', f'{period} {arrival.hour % 12 or 12}:{arrival.minute:02} 도착')
    if not any(re.search(r'(?<!\d)' + re.escape(clock) + r'(?!\S)', chosen) for clock in clocks):
        raise ValueError('The mixed-route card must show the same arrival clock')
    cursor = 0
    for ride in map_display['rides']:
        if ride['kind'] == 'BUS':
            # Collapsed route cards may list alternatives, e.g. "5516 6515 하차".
            # They do not identify one bus for this arrival clock.
            pattern = (r'(?<!\S)' + re.escape(ride['fromName']) + r' (?:중앙 )?' +
                       re.escape(f'{ride["line"]} 하차 {ride["toName"]}') + r'(?!\S)')
            for endpoint in ('from', 'to'):
                ars = ride.get(endpoint + 'Ars')
                if ars is None:
                    continue
                label = ride.get(endpoint + 'ArsLabel') or ''
                if (not re.fullmatch(r'[0-9]{5}', ars) or ars == '00000' or ride[endpoint + 'Name'] not in label or
                        not re.search(r'(?<!\d)' + re.escape(ars) + r'(?!\d)', label) or
                        not matches_full_visible_label(snapshot, label)):
                    raise ValueError('Bus ARS requires its exact visible stop label')
        elif ride['kind'] == 'SUBWAY' and (line := re.fullmatch(r'LINE_([1-9])', ride['line'])):
            # The public collapsed card includes the order of boarding stops. An
            # intermediate rail exit or station interior still requires separate evidence.
            pattern = r'(?<!\S)지하철 ' + line[1] + r'호선 ' + re.escape(ride['fromName']) + r'(?:역)?(?!\S)'
        else:
            raise ValueError('This mixed-route snapshot format requires a numbered subway line')
        location = re.search(pattern, chosen[cursor:])
        if location is None:
            raise ValueError('The selected card must show each boarding in order and a single bus with both stops')
        cursor += location.end()


def verify_snapshot(map_display, snapshot):
    # Only visible text is checked. No hidden endpoint, inferred train number or alighting time.
    normalized = ' '.join(snapshot.split())
    labels = map_display['visibleEvidenceLabels']
    if not labels or any(not label.strip() or ' '.join(label.split()) not in normalized for label in labels):
        raise ValueError('Map labels must exist in the saved public UI snapshot')
    zone = SEOUL
    query = instant(map_display['requestedDepartureAt']).astimezone(zone)
    observed = instant(map_display['observedAt']).astimezone(zone)
    period = '오전' if query.hour < 12 else '오후'
    if query.date() == observed.date():
        day_label = '오늘'
    elif query.date() == observed.date() + dt.timedelta(days=1):
        day_label = f'{query.month}월 {query.day}일'
    else:
        raise ValueError('Use the visible today label or explicit date for a departure after midnight')
    displayed_hour = 0 if query.hour == 0 else query.hour % 12 or 12
    query_label = f'{day_label} {period} {displayed_hour:02}:{query.minute:02} 출발'
    arrival = instant(map_display['displayedArrivalAt']).astimezone(zone)
    contains_bus = any(ride['kind'] == 'BUS' for ride in map_display['rides'])
    if contains_bus:
        verify_bus_route_snapshot(map_display, snapshot, arrival)
    required = [query_label] if contains_bus else [query_label, f'도착 {arrival:%H:%M} ']
    for ride in map_display['rides']:
        if contains_bus and not ride.get('displayedBoardingAt'):
            continue
        clock = instant(ride['displayedBoardingAt']).astimezone(zone).strftime('%H:%M')
        if ride['kind'] == 'BUS':
            label = ride.get('visibleBoardingLabel') or ''
            if not all(piece in label for piece in (clock, ride['line'], ride['fromName'])) or not matches_full_visible_label(snapshot, label):
                raise ValueError('Bus boarding clocks require a visible label for this line and stop')
        else:
            required.append(clock + ride['visibleTerminal'])
    if any(not any(part in label for label in labels) for part in required):
        raise ValueError('Structured clocks must match the exact labels in the visible evidence')


def public_mixed_route_request(map_display, snapshot, *, order, departure, now, require_numeric_points=False):
    """Prepare a selection hint only for a fresh, explicitly expanded public route."""
    if (map_display.get('provider') != 'NAVER_MAP_PUBLIC_UI' or map_display.get('mocked') is not False or
            map_display.get('queryMode') != 'DEPART_AT' or map_display.get('arrivalClockRounding') != 'UNKNOWN'):
        raise ValueError('Use a publicly displayed Naver route with an explicit departure')
    observed = instant(map_display['observedAt'])
    if (instant(map_display['requestedDepartureAt']) != departure or
            not observed <= now < departure or (now - observed).total_seconds() > 300):
        raise ValueError('The same future departure and a public capture within five minutes are required')
    modes = {'bus-rail': ['BUS', 'SUBWAY'], 'rail-bus': ['SUBWAY', 'BUS']}
    if [ride['kind'] for ride in map_display['rides']] != modes.get(order):
        raise ValueError('The visible map route must have the requested bus and subway order')
    verify_snapshot(map_display, snapshot)
    if require_numeric_points:
        require_public_endpoint_walks(map_display, snapshot)
    rows = []
    for line in snapshot.splitlines():
        if button := re.match(r'^\s*-\s+\'?button "([^"]+)"(.*)$', line):
            rows.append(button.groups())
    cards = [index for index, (label, _) in enumerate(rows) if label.endswith(' 상세보기')]
    expanded = [rows[index][0] for index in cards if '[expanded]' in rows[index][1]]
    if expanded != [map_display['routeEvidenceLabel']]:
        raise ValueError('Open only the mapped route card to confirm the rail alighting station')

    rail = next(ride for ride in map_display['rides'] if ride['kind'] == 'SUBWAY')
    line = re.fullmatch(r'LINE_([1-9])', rail['line'])
    if not line or any(not rail.get(key) or rail[key] == 'UNKNOWN' for key in ('fromName', 'toName')):
        raise ValueError('The subway line and both stations must be visible')
    view = [label for label, _ in rows[cards[-1] + 1:]]
    boarding = rf'{line[1]}호선\s*{re.escape(rail["fromName"])}(?:역)?\s+승차(?:\s|$)'
    positions = [index for index, label in enumerate(view) if re.search(boarding, label)]
    if len(positions) != 1:
        raise ValueError('The selected map detail must show the rail boarding station')
    alighting = next((label for label in view[positions[0] + 1:] if re.search(r'\s하차(?:\s|$)', label)), '')
    if not re.search(r'(?<!\S)' + re.escape(rail['toName']) + r'(?:역)?\s+하차(?:\s|$)', alighting):
        raise ValueError('The selected map detail must show the actual rail alighting label')

    origin, destination = coordinates(map_display['requestedCoordinates'])
    bus = next(ride for ride in map_display['rides'] if ride['kind'] == 'BUS')
    if any(not bus.get(key) or bus[key] == 'UNKNOWN' for key in ('line', 'fromName', 'toName')):
        raise ValueError('The bus line and both stops must be visible')
    return {'departureAt': departure.astimezone(dt.timezone.utc).isoformat(), 'observedAt': observed.isoformat(),
            'coordinates': {'origin': {'lat': float(origin[0]), 'lng': float(origin[1])},
                            'destination': {'lat': float(destination[0]), 'lng': float(destination[1])}},
            'route': {'railLine': rail['line'], 'railFrom': rail['fromName'], 'railTo': rail['toName'],
                      'busNumber': bus['line'], 'busFrom': bus['fromName'], 'busTo': bus['toName'],
                      'busFromArs': bus.get('fromArs'), 'busToArs': bus.get('toArs')}}


def public_rail_point_request(map_display, snapshot, *, departure, now):
    """Only prepare a live run with public point pins, an explicit departure and a visible corridor."""
    if (map_display.get('provider') != 'NAVER_MAP_PUBLIC_UI' or map_display.get('mocked') is not False or
            map_display.get('queryMode') != 'DEPART_AT' or map_display.get('arrivalClockRounding') != 'UNKNOWN'):
        raise ValueError('Use a publicly displayed Naver route with an explicit departure')
    observed = instant(map_display['observedAt'])
    if (instant(map_display['requestedDepartureAt']) != departure or
            not observed <= now < departure or (now - observed).total_seconds() > 300):
        raise ValueError('The same future departure and a public capture within five minutes are required')
    verify_snapshot(map_display, snapshot)
    require_public_endpoint_walks(map_display, snapshot)
    rides = map_display['rides']
    if len(rides) != 2 or any(ride['kind'] != 'SUBWAY' for ride in rides):
        raise ValueError('Select the public two-ride subway detail')
    first, second = rides
    if ((first['line'], first['toName'], second['line'], second['fromName'], second['toName']) !=
            ('LINE_4', '사당', 'LINE_2', '사당', '신림') or first['fromName'] not in ('노원', '동작') or
            not rail_detail_matches(map_display, snapshot)):
        raise ValueError('The selected visible boarding and alighting stops must match the observed corridor')
    return {'departureAt': departure.astimezone(dt.timezone.utc).isoformat(), 'observedAt': observed.isoformat(),
            'coordinates': {name: {'lat': float(lat), 'lng': float(lng)} for name, (lat, lng) in
                zip(('origin', 'destination'), coordinates(map_display['requestedCoordinates']))},
            'firstBoardingStation': first['fromName']}


def require_public_endpoint_walks(map_display, snapshot):
    if public_point_alignment(map_display, snapshot) != 'MATCHED_PUBLIC_NUMERIC_POINTS':
        raise ValueError('The public numeric endpoint pins must match the declared coordinates')
    walking = (visible_route_components(map_display) or {}).get('visibleWalkingMinutes') or {}
    if not walking or None in [walking['access'], *walking['transfers'], walking['egress']]:
        raise ValueError('Select a public result that shows both endpoint walks and the transfer walk')


def matches_public_mixed_route(worker, seed, request, *, order):
    """Check that provider requery kept the route and the service IDs used at selection."""
    snapshot = worker['effectiveSnapshot']
    route = snapshot['effectiveTransitRoute']
    observed = instant(request['observedAt'])
    departure = instant(request['departureAt'])
    evaluated = instant(worker['evaluatedAt'])
    if (instant(route['departureAt']) != departure or instant(worker['comparisonRequestedDepartureAt']) != departure or
            not observed <= evaluated < departure or (evaluated - observed).total_seconds() > 300 or
            coordinates(worker['requestedCoordinates']) != coordinates(request['coordinates'])):
        return False
    rides = [leg for leg in route['segments'] if leg['kind'] != 'WALK']
    if [ride['kind'] for ride in rides] != {'bus-rail': ['BUS', 'SUBWAY'], 'rail-bus': ['SUBWAY', 'BUS']}[order]:
        return False
    rail, bus = sorted(rides, key=lambda leg: leg['kind'] == 'BUS')
    requested = request['route']
    if (rail['rideTiming']['timetable']['line'], rail['fromName'], rail['toName'], bus['lineName'], bus['fromName'], bus['toName']) != (
            requested['railLine'], requested['railFrom'], requested['railTo'], requested['busNumber'],
            requested['busFrom'], requested['busTo']):
        return False
    original, = (leg for leg in seed['legs'] if leg['mode'] == 'BUS')
    service = comparison.worker_bus_services(snapshot, route, [bus['sequence']])[bus['sequence']]
    return (service['routeId'] == original['line']['localRouteId'] and
            service['boarding']['stationId'] == original['from']['localStopId'] and
            service['alighting']['stationId'] == original['to']['localStopId'] and
            all(not requested[ars] or service[side]['arsId'] == requested[ars]
                for side, ars in (('boarding', 'busFromArs'), ('alighting', 'busToArs'))))


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
    snapshot = args.snapshot.read_text()
    verify_snapshot(map_display, snapshot)
    comparator = compare if args.prediction_kind == 'accepted-realtime' else compare_timetable_preview
    result = comparator(json.loads(args.worker.read_text()), json.loads(args.public_status.read_text()), map_display, snapshot)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result['result'] in ('DISPLAY_COMPARED', 'TIMETABLE_DISPLAY_COMPARED') else 3)

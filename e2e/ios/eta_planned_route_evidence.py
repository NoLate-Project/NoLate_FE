"""Read bounded post-departure evidence without treating a cached plan as realtime."""
import datetime as dt
import math
from eta_observed_service import observed_service, selected_train_number, reported_boarding_evidence
from copy import deepcopy


def _time(value):
    if not isinstance(value, str):
        raise ValueError('A provider timestamp must be a string')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('A provider timestamp requires an offset')
    return parsed


def accepted_departure_plan(snapshot):
    """Expected persisted plan including only the matching first station's original timestamp."""
    route = snapshot['effectiveTransitRoute']
    obs = snapshot.get('firstBoardingObservation')
    if not snapshot.get('accepted') or not obs or obs['provider'] != 'seoul-openapi':
        return route
    first = min((s for s in route['segments'] if s['kind'] != 'WALK'), key=lambda s: s['sequence'], default=None)
    timing = (first or {}).get('rideTiming') or {}
    table = timing.get('timetable') or {}
    line = table.get('line', '')
    if (not obs.get('trainNumber') or obs['trainNumber'] not in (table.get('trainNumber'), table.get('realtimeTrainNumber')) or
            line not in {f'LINE_{i}' for i in range(1, 10)} or obs['lineName'] != line[-1] + '호선' or
            obs['stationName'] != first['fromName'] or obs['departureAt'] != route['departureAt'] or
            obs['expectedBoardingAt'] != timing.get('predictedBoardingAt') or
            not -5 <= (_time(obs['evaluatedAt']) - _time(obs['sourceUpdatedAt'])).total_seconds() <= 120):
        return route
    basis = timing['basis']
    if basis not in ('FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE', 'FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING',
                     'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME'):
        return route
    source_key = 'boardingObservationSourceUpdatedAt' if basis == 'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME' else 'observationSourceUpdatedAt'
    if timing.get(source_key) is not None:
        return route
    carried = deepcopy(route)
    first_timing = next(s['rideTiming'] for s in carried['segments'] if s['sequence'] == first['sequence'])
    first_timing[source_key] = obs['sourceUpdatedAt']
    if basis == 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE':
        first_timing['basis'] = 'PLANNED_RIDE_BOARDING_REALTIME'
    return carried


def _duration(value):
    minutes, seconds = divmod(math.floor(value + .5), 60)
    return ' '.join(part for part in (f'{minutes}분' if minutes else '', f'{seconds}초' if seconds else '') if part)


def _ride_times(segment):
    if segment['kind'] == 'BUS' and (bus := segment.get('busRidePrediction')):
        return _time(bus['boardingAt']), _time(bus['alightingAt'])
    if segment['kind'] == 'SUBWAY' and (rail := segment.get('rideTiming')):
        return _time(rail['predictedBoardingAt']), _time(rail['predictedArrivalAt'])
    return None


def accepted_ride_labels(route):
    """Exact station clocks expected on the installed app for a fresh accepted route."""
    rail_labels = {
        'TIMETABLE': '시간표',
        'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE': '첫 승차 실시간 반영',
        'TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE': '환승역 실시간 반영',
        'TRANSFER_ALIGHTING_REALTIME': '하차역 실시간 예측',
        'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME': '승하차역 실시간 예측',
        'FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING': '승차역 실시간 · 하차역 시간표',
        'TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING': '승차역 실시간 · 하차역 시간표',
    }
    seoul = dt.timezone(dt.timedelta(hours=9))
    labels = []
    for segment in route['segments']:
        if segment['kind'] == 'WALK':
            continue
        times = _ride_times(segment)
        if times is None or not times[0] < times[1]:
            raise ValueError('Every accepted ride needs chronological station clocks')
        board, alight = [value.astimezone(seoul).strftime('%H:%M:%S') for value in times]
        if segment['kind'] == 'BUS':
            bus = segment['busRidePrediction']
            if bus.get('reportedAlightingAt') or bus.get('alightingObservationSourceUpdatedAt'):
                raise ValueError('An in-progress bus update cannot satisfy departure acceptance')
            labels.append(f'{board} 승차 정류장 도착 예측 → {alight} 하차 정류장 도착 예측')
        else:
            timing = segment['rideTiming']
            basis = rail_labels[timing['basis']]
            start = '승차' if timing['basis'] in ('TIMETABLE', 'TRANSFER_ALIGHTING_REALTIME') else '승차역 열차 도착 예측'
            labels.append(f"{selected_train_number(segment)}열차 · {basis} · {board} {start} → {alight} 하차 예측")
    return labels


def transfer_ride_labels(route):
    """Expected card text for a transfer with timed walks, independent of rounded segment minutes."""
    labels = []
    legs = sorted((route or {}).get('segments', []), key=lambda leg: leg['sequence'])
    if any(leg['sequence'] != index for index, leg in enumerate(legs)):
        return labels
    rides = [i for i, leg in enumerate(legs) if leg['kind'] != 'WALK']
    for prev, nxt in zip(rides, rides[1:]):
        first, second = legs[prev], legs[nxt]
        first_clocks, second_clocks = _ride_times(first), _ride_times(second)
        if first_clocks is None or second_clocks is None:
            continue
        walks = legs[prev + 1:nxt]
        if audit := second.get('transferTiming'):
            walk_seconds = audit['walkingSeconds']
            if (_time(audit['previousArrivalAt']) != first_clocks[1] or
                    _time(audit['boardingAt']) != second_clocks[0] or
                    _time(audit['physicalReadyAt']) != first_clocks[1] + dt.timedelta(seconds=walk_seconds)):
                continue
        elif not walks or any(w.get('walkingScope') not in (None, 'TRANSFER') or
                            type(w.get('durationSeconds')) is not int or w['durationSeconds'] < 0 or
                            (w['durationSeconds'] + 59) // 60 != w['durationMinutes'] or
                            (w.get('walkingTiming') or {}).get('source') == 'ROUTE_MINUTES' for w in walks):
            continue
        else:
            walk_seconds = sum(w['durationSeconds'] for w in walks)
        board, alight = second_clocks
        wait = (board - first_clocks[1]).total_seconds() - walk_seconds
        movement = (alight - board).total_seconds()
        if wait >= .5 and movement >= .5:
            bus = second['kind'] == 'BUS'
            scope = '승차 정류장부터 하차 정류장까지' if bus else '승차역부터 하차역까지'
            suffix = '' if bus else f" · {selected_train_number(second)}열차"
            labels.append(f"환승 대기 약 {_duration(wait)} · {scope} 약 {_duration(movement)}{suffix}")
    return labels


def first_ride_intervals(route):
    """Compute the two non-overlapping display intervals from the preserved route's clocks."""
    if not route or not route.get('segments'):
        return None
    ready = _time(route['departureAt'])
    for index, segment in enumerate(sorted(route['segments'], key=lambda leg: leg['sequence'])):
        if segment['sequence'] != index:
            return None
        if segment['kind'] == 'WALK':
            seconds = segment.get('durationSeconds')
            if type(seconds) is not int or seconds < 0 or (seconds + 59) // 60 != segment['durationMinutes']:
                return None
            ready += dt.timedelta(seconds=seconds)
            continue
        clocks = _ride_times(segment)
        if clocks is None:
            return None
        board, alight = clocks
        wait, ride = (board - ready).total_seconds(), (alight - board).total_seconds()
        if min(wait, ride) < .5:
            return None
        if segment['kind'] == 'BUS':
            return {'wait': f'첫 승차 대기 약 {_duration(wait)} (버스 도착 기준)',
                    'ride': f'승차 정류장부터 하차 정류장까지 약 {_duration(ride)}',
                    'inclusiveMinutes': math.ceil((wait + ride) / 60)}
        timing = segment['rideTiming']
        station_arrival = (timing['basis'] in (
            'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE', 'FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING',
            'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME', 'PLANNED_RIDE_BOARDING_REALTIME',
            'TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE', 'OBSERVED_SUBWAY_SERVICE_REALTIME',
            'REPORTED_BOARDING_AND_ALIGHTING_REALTIME') or timing.get('plannedBoardingIsStationArrival') is True)
        event = '도착' if station_arrival else '출발'
        return {'wait': f'첫 승차 대기 약 {_duration(wait)} (열차 {event} 기준)',
                'ride': f'승차역부터 하차역까지 약 {_duration(ride)}', 'inclusiveMinutes': math.ceil((wait + ride) / 60)}
    return None


def planned_first_boarding_window(route, worker, *, now):
    """Observe a late first train while its destination is still outside the arrival lookup window."""
    rides = [leg for leg in (route or {}).get('segments', []) if leg['kind'] == 'SUBWAY']
    if not rides:
        return None
    first = rides[0]
    if not first.get('fromName'):
        return None
    timing = first['rideTiming']
    boarding = max(_time(timing['timetable']['boardingAt']), _time(timing['predictedBoardingAt']))
    at = max(now + dt.timedelta(seconds=2), _time(worker['nextCheckAt']),
             boarding + dt.timedelta(seconds=121), _time(route['departureAt']) + dt.timedelta(seconds=1))
    if (at > boarding + dt.timedelta(minutes=20) or
            at >= min(_time(timing['predictedArrivalAt']) - dt.timedelta(minutes=15),
                      _time(worker['targetArrivalAt']))):
        return None
    return {'stage': 'FIRST_BOARDING_RECHECK', 'at': at.isoformat(), 'sequence': first['sequence'],
            'station': first['fromName'], 'trainNumber': selected_train_number(first),
            'predictedBoardingAt': timing['predictedBoardingAt']}


def planned_observation_window(route, worker, *, final, now):
    """Pick the station for the next available evaluation using only the current plan."""
    rides = [s for s in route['segments'] if s['kind'] == 'SUBWAY']
    if not rides or not worker.get('nextCheckAt'):
        return None
    ride = rides[-1] if final else rides[0]
    timing = ride['rideTiming']
    alight = _time(timing['predictedArrivalAt'])
    # Wait until after boarding so the Worker requests the alighting station.
    # Allow time for the real API read and the installed app to show the forecast.
    at = max(now, _time(worker['nextCheckAt']), _time(route['departureAt']) + dt.timedelta(seconds=10),
             _time(timing['predictedBoardingAt']) + dt.timedelta(seconds=1),
             alight - dt.timedelta(minutes=4 if final else 5))
    if at >= min(alight, _time(worker['targetArrivalAt'])):
        return None
    return {'stage': 'FINAL_ALIGHTING' if final else 'FIRST_ALIGHTING',
            'at': at.isoformat(), 'sequence': ride['sequence'], 'station': ride['toName'],
            'trainNumber': selected_train_number(ride), 'predictedArrivalAt': timing['predictedArrivalAt']}


def next_planned_observation_window(route, worker, *, evaluation_index,
                                    first_boarding_recheck=False, first_boarding_followup='first-alighting',
                                    observed_service_connection=False, now):
    """Choose one of the two remaining evaluations; never add a fourth provider round."""
    if evaluation_index not in (1, 2) or first_boarding_followup not in ('first-alighting', 'final-alighting'):
        raise ValueError('Only the two remaining planned observation windows are supported')
    if first_boarding_followup == 'final-alighting' and not first_boarding_recheck:
        raise ValueError('A final follow-up requires the explicit first-boarding scenario')
    if first_boarding_recheck and evaluation_index == 1:
        return planned_first_boarding_window(route, worker, now=now)
    if observed_service_connection and evaluation_index == 2:
        ride = next((s for s in reversed(route['segments']) if s['kind'] == 'SUBWAY'), None)
        if ride is None:
            return None
        timing = ride['rideTiming']
        board, alight = _time(timing['predictedBoardingAt']), _time(timing['predictedArrivalAt'])
        at = max(now, _time(worker['nextCheckAt']), _time(route['departureAt']) + dt.timedelta(seconds=10),
                 board - dt.timedelta(minutes=1), alight - dt.timedelta(minutes=15))
        if at >= min(board, alight, _time(worker['targetArrivalAt'])):
            return None
        return {'stage': 'OBSERVED_SERVICE_CONNECTION', 'at': at.isoformat(), 'sequence': ride['sequence'],
                'station': ride['fromName'], 'trainNumber': selected_train_number(ride),
                'predictedBoardingAt': timing['predictedBoardingAt'], 'predictedArrivalAt': timing['predictedArrivalAt']}
    window = planned_observation_window(route, worker,
        final=evaluation_index > 1 and (not first_boarding_recheck or first_boarding_followup == 'final-alighting'),
        now=now)
    if window is None and evaluation_index == 1 and not first_boarding_recheck:
        return planned_observation_window(route, worker, final=True, now=now)
    return window


def fresh_final_alighting(observation, prior_route, evaluated_at):
    """A successful first-ride or last boarding update cannot prove a new final station forecast."""
    route = (observation or {}).get('effectiveTransitRoute')
    if not route or route['identity'] != prior_route['identity']:
        return None
    last = next(s for s in reversed(route['segments']) if s['kind'] == 'SUBWAY')
    prior = next(s for s in reversed(prior_route['segments']) if s['kind'] == 'SUBWAY')
    timing, previous = last['rideTiming'], prior['rideTiming']
    if timing.get('observedService') != previous.get('observedService'):
        return None
    table, old_table = timing['timetable'], previous['timetable']
    fields = ('provider', 'serviceDate', 'line', 'directionCode', 'serviceClass',
              'trainNumber', 'fromStationCode', 'toStationCode', 'boardingAt', 'arrivalAt')
    if (timing['basis'] != 'PLANNED_RIDE_ALIGHTING_REALTIME' or last['sequence'] != prior['sequence']
            or table.get('terminalName') != old_table.get('terminalName')
            or any(not table.get(k) or table[k] != old_table.get(k) for k in fields)):
        return None
    source = _time(timing['observationSourceUpdatedAt'])
    now = _time(evaluated_at)
    prior_direct = previous.get('observationSourceUpdatedAt') if previous['basis'] in (
        'PLANNED_RIDE_ALIGHTING_REALTIME', 'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME', 'TRANSFER_ALIGHTING_REALTIME',
        'OBSERVED_SUBWAY_SERVICE_REALTIME') else None
    if (not 0 <= (now - source).total_seconds() <= 120 or
            not _time(timing['predictedBoardingAt']) < now < _time(timing['predictedArrivalAt']) or
            (prior_direct and source <= _time(prior_direct))):
        return None
    return {'trainNumber': selected_train_number(last), 'station': last['toName'],
            'sourceUpdatedAt': timing['observationSourceUpdatedAt'], 'predictedAlightingAt': timing['predictedArrivalAt'],
            'predictedDestinationArrivalAt': route['arrivalAt']}


def _independent_timetable_candidate(worker, route, now, target):
    """Require the exact same-evaluation returned candidate, not a new failure allowlist."""
    trace = worker.get('futureTimetablePlanTrace') or {}
    if (trace.get('classification') != 'PASSIVE_REAL_FUTURE_TIMETABLE_PLAN_TRACE' or
            trace.get('additionalHttpCalls') != 0 or trace.get('responseModified') is not False):
        return False
    events = trace.get('events') or []
    if not events:
        return False
    event = events[-1]
    evidence = event.get('futureTimetablePlanEvidence') or {}
    diagnostic = worker['effectiveSnapshot'].get('effectiveTransitRoute') or {}
    if (evidence.get('route') != route or evidence.get('provenance') != 'SELECTED_ROUTE_PRESERVED' or
            (evidence.get('failureReason') or '').split(':')[0] not in
            ('TRANSIT_TRAIN_NOT_YET_OBSERVED', 'TRANSIT_ARRIVAL_SOURCE_STALE') or
            event.get('source') != worker['source'] or event.get('stale') is not True or
            event.get('failureReason') != worker['failureReason'] or
            _time(event['targetArrivalAt']) != target or
            not _time(event['evaluatedAt']) <= _time(event['returnedAt']) <= now or
            _time(evidence['fetchedAt']) > _time(event['returnedAt']) or
            not _time(event['plannedDepartureAt']) <= _time(route['departureAt']) <
                _time(event['plannedDepartureAt']) + dt.timedelta(seconds=60) or
            route['identity'] != diagnostic.get('identity') or route['provider'] != diagnostic.get('provider')):
        return False
    config = worker['plannedRefreshReplay']
    boarding_margin = config['boardingBufferSeconds']
    transfer_margin = config['transferConfidenceMarginSeconds'] + config['transferBufferSeconds']
    if boarding_margin < 0 or transfer_margin < 0:
        return False
    cursor, rides = _time(route['departureAt']), 0
    for index, leg in enumerate(route['segments']):
        if leg['sequence'] != index:
            return False
        if leg['kind'] == 'WALK':
            seconds = leg.get('durationSeconds')
            if type(seconds) is not int or seconds < 0 or (seconds + 59) // 60 != leg['durationMinutes']:
                return False
            cursor += dt.timedelta(seconds=seconds)
            continue
        timing = leg['rideTiming']
        table = timing['timetable']
        board, alight = _time(table['boardingAt']), _time(table['arrivalAt'])
        local = board.astimezone(dt.timezone(dt.timedelta(hours=9)))
        day = dt.date.fromisoformat(table['serviceDate'])
        if (leg['kind'] != 'SUBWAY' or table['provider'] != 'seoul-timetable' or
                timing['basis'] != 'TIMETABLE' or not board < alight or
                timing.get('observationSourceUpdatedAt') is not None or timing.get('boardingObservationSourceUpdatedAt') is not None or
                not (day == local.date() or day + dt.timedelta(days=1) == local.date() and local.hour < 4)):
            return False
        readiness = cursor + dt.timedelta(seconds=boarding_margin if rides == 0 else transfer_margin)
        limit = _time(table.get('boardingStationArrivalAt') or table['boardingAt']) if rides == 0 else board
        if readiness > limit:
            return False
        cursor, rides = alight, rides + 1
    seconds = (cursor - _time(route['departureAt'])).total_seconds()
    return rides > 0 and cursor == _time(route['arrivalAt']) and seconds > 0 and (seconds + 59) // 60 == route['totalMinutes']


def verified_timetable_plan(worker):
    """A complete stored timetable plan is not an accepted realtime result."""
    try:
        snapshot = worker['effectiveSnapshot']
        route = snapshot.get('lastTimetablePlannedRoute')
        now, target = _time(worker['evaluatedAt']), _time(worker['targetArrivalAt'])
        if (worker['source'] != 'TIMETABLE_PROVIDER' or worker['stale'] is not True or
                (worker.get('failureReason') or '').split(':')[0] not in (
                    'TRANSIT_TRAIN_NOT_YET_OBSERVED', 'TRANSIT_ARRIVAL_SOURCE_STALE', 'TRANSIT_ARRIVAL_OUT_OF_HORIZON') or
                snapshot.get('accepted') is not False or snapshot.get('transitTimingBasis') != 'TIMETABLE_ONLY' or
                not route or
                not now < _time(route['departureAt']) < _time(route['arrivalAt']) <= target):
            return None
        independent = (route != snapshot.get('effectiveTransitRoute') or
                       worker['failureReason'].startswith('TRANSIT_ARRIVAL_OUT_OF_HORIZON:'))
        if independent and not _independent_timetable_candidate(worker, route, now, target):
            return None
        rides = [s for s in route['segments'] if s['kind'] != 'WALK']
        if not rides or any(s['kind'] != 'SUBWAY' or s['rideTiming']['basis'] != 'TIMETABLE' or
                _time(s['rideTiming']['timetable']['fetchedAt']) > now or
                s['rideTiming']['predictedBoardingAt'] != s['rideTiming']['timetable']['boardingAt'] or
                s['rideTiming']['predictedArrivalAt'] != s['rideTiming']['timetable']['arrivalAt'] for s in rides):
            return None
        return route
    except (KeyError, TypeError, ValueError):
        return None


def verify_expired_plan_status(worker, public):
    """A later public read preserves the plan and alarm, while expiring all live claims."""
    snapshot = worker['effectiveSnapshot']
    plan = (snapshot.get('lastUpdatedPlannedRoute') or snapshot.get('inProgressPlannedRoute') or
            snapshot.get('lastTimetablePlannedRoute') or snapshot.get('effectiveTransitRoute'))
    read_at = _time(public['evaluatedAt'])
    deadline = _time(worker['etaRefreshDueAt']) + dt.timedelta(minutes=worker['etaSnapshotGraceMinutes'])
    assert deadline < read_at < _time(plan['arrivalAt'])
    assert plan and public['stale'] is True and public['confidence'] == 'LOW'
    assert all(public.get(k) is None for k in ('travelMinutes', 'source', 'liveFetchedAt', 'failureReason',
        'predictedArrivalAt', 'onTimeArrivalPossible', 'effectiveTransitRoute', 'firstBoardingObservation', 'futureTimetablePrediction'))
    assert _time(public['recommendedDepartureAt']) == _time(worker['recommendedDepartureAt'])
    prediction = public['plannedJourneyArrivalPrediction']
    assert prediction['basis'] == 'LAST_ACCEPTED_PLAN' and prediction.get('sourceUpdatedAt') is None
    assert prediction['routeIdentity'] == plan['identity']
    assert _time(prediction['predictedArrivalAt']) == _time(plan['arrivalAt'])
    assert (public.get('originReplanDiagnostic') or {}).get('failureReason', '').startswith('ETA_SNAPSHOT_EXPIRED:')
    route = prediction['effectiveTransitRoute']
    assert route['identity'] == plan['identity'] and route['provider'] == plan['provider']
    assert _time(route['departureAt']) == _time(plan['departureAt'])
    assert len(route['segments']) == len(plan['segments'])
    for current, previous in zip(route['segments'], plan['segments']):
        assert current['sequence'] == previous['sequence'] and current['kind'] == previous['kind']
        if current['kind'] == 'WALK':
            assert current == previous
        else:
            assert current['kind'] == 'SUBWAY'
            a, b = current['rideTiming'], previous['rideTiming']
            assert a['timetable'] == b['timetable']
            assert a['basis'] in ('TIMETABLE', 'PLANNED_RIDE_BASELINE') and a.get('observationSourceUpdatedAt') is None
            assert a.get('boardingObservationSourceUpdatedAt') is None
            assert _time(a['predictedBoardingAt']) == _time(b['predictedBoardingAt'])
            assert _time(a['predictedArrivalAt']) == _time(b['predictedArrivalAt'])
    return {'result': 'PASSED', 'departureProtectionPreserved': True, 'cachedTrainClocksPreserved': True,
            'expiredObservationsNotPromoted': True, 'publicTransitHttpCallsForRead': 0,
            'actualTripAccuracyVerified': False}


def qualifying_planned_observation(worker):
    """Return one fresh, independently identifiable provisional calculation or None."""
    try:
        snapshot = worker.get('effectiveSnapshot') or {}
        plan = snapshot.get('inProgressPlannedRoute') or {}
        now = _time(worker['evaluatedAt'])
        if now < _time(plan['departureAt']):
            return None
        update = snapshot.get('plannedRouteUpdate')
        if update is not None:
            route = update.get('route')
            if update.get('failure') or not route or update.get('routeIdentity') != plan['identity']:
                return None
            if (route['identity'] != plan['identity'] or route['provider'] != plan['provider'] or
                    _time(route['departureAt']) != _time(plan['departureAt'])):
                return None
            current, original = route['segments'], plan['segments']
            if len(current) != len(original):
                return None
            observed = []
            cursor = _time(route['departureAt'])
            for a, b in zip(current, original):
                if a['sequence'] != b['sequence'] or a['kind'] != b['kind']:
                    return None
                if a['kind'] == 'WALK':
                    for field in ('durationSeconds', 'durationMinutes', 'walkingGeometry', 'walkingTiming'):
                        if a.get(field) != b.get(field):
                            return None
                    cursor += dt.timedelta(seconds=a.get('durationSeconds')
                                           if a.get('durationSeconds') is not None else a['durationMinutes'] * 60)
                    continue
                if a['kind'] != 'SUBWAY':
                    return None
                timing, old = a['rideTiming'], b['rideTiming']
                service = observed_service(a)
                historical = reported_boarding_evidence(a, route, now)
                table, old_table = timing['timetable'], old['timetable']
                for field in ('provider', 'line', 'serviceDate', 'directionCode', 'serviceClass',
                              'fromStationCode', 'toStationCode'):
                    if table[field] != old_table[field]:
                        return None
                board, alight = _time(timing['predictedBoardingAt']), _time(timing['predictedArrivalAt'])
                if board < cursor or alight <= board:
                    return None
                transfer = a.get('transferTiming')
                if transfer and board < _time(transfer['previousArrivalAt']) + dt.timedelta(
                        seconds=transfer['walkingSeconds'] + transfer['requiredMarginSeconds']):
                    return None
                cursor = alight
                early_boarding = timing['basis'] in ('FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING',
                                                     'TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING')
                if early_boarding:
                    scheduled_board = _time(table.get('boardingStationArrivalAt') or table['boardingAt'])
                    if board >= scheduled_board or alight != _time(table['arrivalAt']) or update.get('onlyLastRideObserved'):
                        return None
                if early_boarding or timing['basis'] in ('PLANNED_RIDE_ALIGHTING_REALTIME', 'PLANNED_RIDE_BOARDING_REALTIME',
                                                       'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME',
                                                       'TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE', 'OBSERVED_SUBWAY_SERVICE_REALTIME',
                                                       'REPORTED_BOARDING_AND_ALIGHTING_REALTIME'):
                    source = _time(timing['observationSourceUpdatedAt'])
                    if not -5 <= (now - source).total_seconds() <= 120 or not table['trainNumber']:
                        return None
                    observed.append(source)
                    if timing.get('boardingObservationSourceUpdatedAt') is not None:
                        boarding_source = _time(timing['boardingObservationSourceUpdatedAt'])
                        if not historical and not -5 <= (now - boarding_source).total_seconds() <= 120:
                            return None
                        if not historical:
                            observed.append(boarding_source)
                    if timing['basis'] == 'OBSERVED_SUBWAY_SERVICE_REALTIME' and (
                            service is None or timing.get('boardingObservationSourceUpdatedAt') is None or
                            abs((source - boarding_source).total_seconds()) > 125):
                        return None
            source = _time(update['sourceUpdatedAt'])
            if (not observed or source > min(observed) or
                    not -5 <= (now - source).total_seconds() <= 120 or
                    cursor != _time(route['arrivalAt']) or cursor <= now):
                return None
            return {'routeIdentity': plan['identity'], 'sourceUpdatedAt': update['sourceUpdatedAt'],
                    'predictedArrivalAt': route['arrivalAt'], 'effectiveTransitRoute': route,
                    'basis': 'OBSERVED_SERVICE_CONNECTION' if any((s.get('rideTiming') or {}).get('observedService') for s in current)
                    else 'MATCHED_TRAIN_REALTIME' if update.get('onlyLastRideObserved')
                    else 'MATCHED_RIDE_AND_ONWARD_TIMETABLE'}
        observation = snapshot.get('plannedArrivalObservation') or {}
        if (observation.get('routeIdentity') != plan['identity'] or
                not -5 <= (now - _time(observation['sourceUpdatedAt'])).total_seconds() <= 120 or
                _time(observation['predictedArrivalAt']) <= now):
            return None
        return dict(observation, basis='MATCHED_TRAIN_REALTIME')
    except (KeyError, TypeError, ValueError):
        return None


def observed_service_scope_valid(*, timetable, positions, max_evaluations):
    """A first-alighting second round and a last-boarding third round share the same existing budget."""
    return timetable is True and positions is True and max_evaluations == 3

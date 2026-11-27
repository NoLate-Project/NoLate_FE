"""Evaluate mixed-route station forecasts within the existing three Worker rounds."""
import datetime as dt
import re

from eta_planned_route_evidence import _ride_times, _time


def _legs(route, order):
    expected = ['BUS', 'SUBWAY'] if order == 'bus-rail' else ['SUBWAY', 'BUS']
    legs = route['segments']
    if (order not in ('bus-rail', 'rail-bus') or route['provider'] != 'odsay' or
            [leg['kind'] for leg in legs] != ['WALK', expected[0], 'WALK', expected[1], 'WALK'] or
            [leg['sequence'] for leg in legs] != list(range(5))):
        raise ValueError('Unsupported mixed route')
    return legs


def mixed_observation_window(route, worker, *, evaluation_index, now):
    """Look at inbound alighting first and the current final vehicle on the last round."""
    if evaluation_index not in (1, 2) or not worker.get('nextCheckAt'):
        return None
    try:
        legs = _legs(route, worker['mixedRouteOrder'])
        for index in (1, 3) if evaluation_index == 1 else (3,):
            ride = legs[index]
            board, alight = _ride_times(ride)
            at = max(now + dt.timedelta(seconds=2), _time(worker['nextCheckAt']),
                     _time(route['departureAt']) + dt.timedelta(seconds=10), board + dt.timedelta(seconds=1),
                     alight - dt.timedelta(minutes=4 if index == 3 else 5))
            if ride.get('toName') and at < min(alight, _time(worker['targetArrivalAt'])):
                return {'stage': 'MIXED_FINAL_ALIGHTING' if index == 3 else 'MIXED_INBOUND_ALIGHTING',
                        'at': at.isoformat(), 'sequence': index, 'mode': ride['kind'], 'station': ride['toName']}
    except (KeyError, TypeError, ValueError):
        return None
    return None


def _bus_binding(journey, route, sequence):
    ride, = journey['rides']
    if ride['sequence'] != sequence or (journey['routeIdentity'], journey['departureAt']) != (
            route['identity'], route['departureAt']):
        raise ValueError('Unbound bus')
    service = ride['service']
    endpoints = [service[point] for point in ('boarding', 'alighting')]
    if (not re.fullmatch(r'[1-9][0-9]{8}', service['routeId']) or not service['direction'] or
            not re.fullmatch(r'[a-f0-9]{64}', service['vehicleKey']) or
            any(not re.fullmatch(r'[1-9][0-9]{8}', stop['stationId']) or
                not re.fullmatch(r'[0-9]{5}', stop['arsId']) or stop['arsId'] == '00000' or
                type(stop['order']) is not int for stop in endpoints) or
            not 1 <= endpoints[0]['order'] < endpoints[1]['order'] <= 999 or
            endpoints[0]['stationId'] == endpoints[1]['stationId']):
        raise ValueError('Invalid bus service')
    return service


def qualifying_mixed_observation(worker):
    """Require a bound vehicle, a usable transfer and a fresh upstream or final forecast."""
    try:
        order = worker['mixedRouteOrder']
        snapshot, prediction = worker['effectiveSnapshot'], worker['mixedPredictionAtEvaluation']
        original, update = snapshot['inProgressPlannedRoute'], snapshot['plannedRouteUpdate']
        route = update['route']
        public_route = prediction['effectiveTransitRoute']
        before = worker['mixedPlanBeforeEvaluation']
        prior = before['route']
        identity, departure = original['identity'], _time(original['departureAt'])
        now, source = _time(worker['evaluatedAt']), _time(update['sourceUpdatedAt'])
        basis = prediction['basis']
        max_age = {'FINAL_BUS_ALIGHTING_REPORTED': 1200, 'MATCHED_TRAIN_REALTIME': 120}.get(basis, 45)
        if (update.get('failure') or update['routeIdentity'] != identity or prediction['routeIdentity'] != identity or
                _time(prediction['sourceUpdatedAt']) != source or _time(prediction['presentedAt']) != now or
                not 0 <= (now - source).total_seconds() <= max_age or now < departure or
                any(r['identity'] != identity or _time(r['departureAt']) != departure for r in (route, prior, public_route))):
            return None
        legs, original_legs, prior_legs, public_legs = (_legs(r, order) for r in (route, original, prior, public_route))
        for index in (0, 2, 4):
            if legs[index] != original_legs[index] or public_legs[index] != legs[index]:
                return None
        for index in (1, 3):
            if any(legs[index].get(key) != original_legs[index].get(key) or
                   legs[index].get(key) != public_legs[index].get(key) for key in ('lineName', 'fromName', 'toName')) or \
                    _ride_times(legs[index]) != _ride_times(public_legs[index]):
                return None
        access, walk, egress = (dt.timedelta(seconds=legs[i]['durationSeconds']) for i in (0, 2, 4))
        first_board, first_alight = _ride_times(legs[1])
        final_board, final_alight = _ride_times(legs[3])
        transfer = legs[3]['transferTiming']
        arrival = _time(prediction['predictedArrivalAt'])
        if (min(access, walk, egress) < dt.timedelta() or not departure + access <= first_board < first_alight or
                transfer['walkingSeconds'] != walk.total_seconds() or _time(transfer['previousArrivalAt']) != first_alight or
                _time(transfer['physicalReadyAt']) != first_alight + walk or
                transfer['requiredMarginSeconds'] != max(transfer['bufferSeconds'], transfer['confidenceMarginSeconds']) or
                transfer['requiredMarginSeconds'] < 0 or _time(transfer['confidenceReadyAt']) != first_alight + walk +
                dt.timedelta(seconds=transfer['requiredMarginSeconds']) or
                not _time(transfer['confidenceReadyAt']) <= _time(transfer['boardingAt']) == final_board < final_alight or
                arrival != final_alight + egress or any(arrival != _time(r['arrivalAt']) for r in (route, public_route)) or
                now >= arrival):
            return None
        bus_index = 1 if order == 'bus-rail' else 3
        bus = legs[bus_index]['busRidePrediction']
        prior_bus = prior_legs[bus_index]['busRidePrediction']
        old_service = _bus_binding(before['busJourney'], prior, bus_index)
        service = _bus_binding(snapshot['plannedSeoulBusJourney'], route, bus_index)
        if any(service[field] != old_service[field] for field in ('routeId', 'direction', 'boarding', 'alighting')):
            return None
        train_index = 4 - bus_index
        train, prior_train = (rows[train_index]['rideTiming'] for rows in (legs, prior_legs))
        fields = ('provider', 'serviceDate', 'line', 'directionCode', 'serviceClass', 'fromStationCode', 'toStationCode')
        if any(not train['timetable'][field] or train['timetable'][field] != prior_train['timetable'][field] for field in fields):
            return None
        evidence_kind = 'FORECAST'
        if basis == 'FINAL_BUS_ALIGHTING_REPORTED' and bus_index == 3:
            report = update['reportedBusAlighting']
            checked, reported = _time(report['checkedAt']), _time(report['reportedAt'])
            if (service != old_service or report['service'] != service or report['routeIdentity'] != identity or
                    report['sequence'] != bus_index or _time(report['departureAt']) != departure or
                    bus['boardingAt'] != prior_bus['boardingAt'] or
                    prior_bus.get('reportedAlightingAt') is not None or _time(bus['reportedAlightingAt']) != reported or
                    reported != source or final_alight != reported or not final_board < reported <= checked <= now or
                    (checked - reported).total_seconds() > 45 or bus.get('alightingObservationSourceUpdatedAt') is not None):
                return None
            stage, evidence_kind = 'FINAL_ALIGHTING', 'STOP_REPORTED'
        elif basis == 'MATCHED_BUS_REALTIME' and service == old_service:
            old_source = prior_bus.get('alightingObservationSourceUpdatedAt') or prior_bus['sourceUpdatedAt']
            board, alight = _ride_times(legs[bus_index])
            forecast_source = _time(bus['alightingObservationSourceUpdatedAt'])
            if (bus['boardingAt'] != prior_bus['boardingAt'] or not _time(old_source) < forecast_source or
                    not board <= source <= forecast_source <= now < alight):
                return None
            stage = 'INBOUND_CONNECTION' if bus_index == 1 else 'FINAL_ALIGHTING'
        elif basis == 'MATCHED_TRAIN_AND_BUS_REALTIME' and bus_index == 3 and update.get('railToBusConnectionObserved') is True:
            if train['basis'] not in ('PLANNED_RIDE_ALIGHTING_REALTIME', 'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME',
                                       'OBSERVED_SUBWAY_SERVICE_REALTIME', 'REPORTED_BOARDING_AND_ALIGHTING_REALTIME'):
                return None
            sources = [_time(train['observationSourceUpdatedAt']), _time(bus['sourceUpdatedAt'])]
            if train.get('boardingObservationSourceUpdatedAt') and not train.get('reportedBoarding'):
                sources.append(_time(train['boardingObservationSourceUpdatedAt']))
            if source != min(sources) or max(sources) > now or not first_board < now < first_alight:
                return None
            stage = 'INBOUND_CONNECTION'
        elif basis == 'MATCHED_TRAIN_REALTIME' and bus_index == 1 and update.get('onlyLastRideObserved') is True:
            old_source = prior_train.get('observationSourceUpdatedAt')
            if (service != old_service or train['timetable'] != prior_train['timetable'] or
                    train.get('observedService') != prior_train.get('observedService') or
                    train['predictedBoardingAt'] != prior_train['predictedBoardingAt'] or
                    train['basis'] != 'PLANNED_RIDE_ALIGHTING_REALTIME' or
                    _time(train['observationSourceUpdatedAt']) != source or not final_board < now < final_alight or
                    (old_source and _time(old_source) >= source)):
                return None
            stage = 'FINAL_ALIGHTING'
        else:
            return None
        return {**prediction, 'mixedStage': stage, 'maxAgeSeconds': max_age, 'alightingEvidence': evidence_kind}
    except (KeyError, TypeError, ValueError):
        return None


def mixed_postdeparture_audit(evaluations):
    checked = [row for row in evaluations[1:] if row.get('uiResult') == 'PROVISIONAL_PASSED' and row.get('originSearchCalls') == 0]
    stages = {row.get('mixedStage') for row in checked}
    departure = evaluations[0].get('recommendedDepartureAt') if evaluations else None
    unchanged = bool(departure and checked and all(row.get('recommendedDepartureAt') == departure for row in evaluations))
    no_new_alarm = bool(evaluations) and all(row.get('automaticAlarmStateCount') == 0 for row in evaluations)
    return {'classification': 'REAL_MIXED_POSTDEPARTURE_FORECAST_NOT_PHYSICAL_TRIP',
            'result': 'PASSED' if len(evaluations) == 3 and evaluations[0].get('accepted') is True and unchanged and
                     no_new_alarm and {'INBOUND_CONNECTION', 'FINAL_ALIGHTING'} <= stages else 'PARTIAL',
            'evaluationCount': len(evaluations), 'departureRecommendationUnchanged': unchanged,
            'inboundConnectionApiAndAppVerified': 'INBOUND_CONNECTION' in stages,
            'finalAlightingApiAndAppVerified': 'FINAL_ALIGHTING' in stages, 'physicalArrivalMeasured': False}

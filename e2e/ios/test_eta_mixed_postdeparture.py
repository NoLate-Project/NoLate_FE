import copy
import datetime as dt
import unittest

from eta_mixed_postdeparture import mixed_observation_window, mixed_postdeparture_audit, qualifying_mixed_observation


def at(seconds):
    return (dt.datetime(2026, 11, 27, 9, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=seconds)).isoformat()


def fixture(order, stage):
    bus_index = 1 if order == 'bus-rail' else 3
    train_index = 4 - bus_index
    now = 200 if stage == 'INBOUND_CONNECTION' else 500
    source = now - 10
    bus_board, bus_alight = (100, 260) if bus_index == 1 else (360, 620)
    train_board, train_alight = (100, 260) if train_index == 1 else (360, 620)
    walk = [{'sequence': i, 'kind': 'WALK', 'durationSeconds': seconds, 'durationMinutes': 1}
            for i, seconds in ((0, 30), (2, 30), (4, 60))]
    bus = {'sequence': bus_index, 'kind': 'BUS', 'lineName': '402', 'fromName': '승차', 'toName': '하차',
           'busRidePrediction': {'boardingAt': at(bus_board), 'alightingAt': at(bus_alight), 'sourceUpdatedAt': at(-5)}}
    train = {'sequence': train_index, 'kind': 'SUBWAY', 'lineName': '4호선', 'fromName': '동작', 'toName': '사당',
             'rideTiming': {'basis': 'TIMETABLE', 'predictedBoardingAt': at(train_board),
                            'predictedArrivalAt': at(train_alight),
                            'timetable': {'provider': 'seoul-timetable', 'serviceDate': '2026-11-27', 'line': 'LINE_4',
                                          'directionCode': 'DOWN', 'serviceClass': 'LOCAL', 'trainNumber': '4703',
                                          'fromStationCode': '0431', 'toStationCode': '0433'}}}
    legs = sorted([*walk, bus, train], key=lambda leg: leg['sequence'])
    legs[3]['transferTiming'] = {'walkingSeconds': 30, 'previousArrivalAt': at(260), 'physicalReadyAt': at(290),
                                 'confidenceReadyAt': at(350), 'boardingAt': at(360), 'requiredMarginSeconds': 60,
                                 'bufferSeconds': 0, 'confidenceMarginSeconds': 60}
    original = {'provider': 'odsay', 'identity': 'a' * 64, 'departureAt': at(0), 'arrivalAt': at(680), 'segments': legs}
    binding = {'routeIdentity': original['identity'], 'departureAt': at(0), 'rides': [{'sequence': bus_index, 'service': {
        'routeId': '100100101', 'direction': 'down', 'vehicleKey': '0' * 64,
        'boarding': {'stationId': '100100102', 'arsId': '01001', 'order': 1},
        'alighting': {'stationId': '100100103', 'arsId': '01002', 'order': 3}}}]}
    before = {'route': copy.deepcopy(original), 'busJourney': copy.deepcopy(binding)}
    route = copy.deepcopy(original)
    bus, train = route['segments'][bus_index]['busRidePrediction'], route['segments'][train_index]['rideTiming']
    belief = {'routeIdentity': original['identity'], 'sourceUpdatedAt': at(source), 'route': route}
    if (bus_index == 1) == (stage == 'INBOUND_CONNECTION'):
        basis = 'MATCHED_BUS_REALTIME'
        bus['alightingObservationSourceUpdatedAt'] = at(source + 4)  # Independent of location-feed freshness.
    elif bus_index == 3:
        basis = 'MATCHED_TRAIN_AND_BUS_REALTIME'
        belief['railToBusConnectionObserved'] = True
        train.update(basis='PLANNED_RIDE_ALIGHTING_REALTIME', observationSourceUpdatedAt=at(source))
        bus['sourceUpdatedAt'] = at(source + 4)
        binding['rides'][0]['service']['vehicleKey'] = '1' * 64
    else:
        basis = 'MATCHED_TRAIN_REALTIME'
        belief['onlyLastRideObserved'] = True
        train.update(basis='PLANNED_RIDE_ALIGHTING_REALTIME', observationSourceUpdatedAt=at(source))
    return {'mixedRouteOrder': order, 'evaluatedAt': at(now), 'targetArrivalAt': at(1000), 'nextCheckAt': at(now + 10),
            'mixedPlanBeforeEvaluation': before, 'effectiveSnapshot': {'inProgressPlannedRoute': original,
                'plannedSeoulBusJourney': binding, 'plannedRouteUpdate': belief},
            'mixedPredictionAtEvaluation': {'basis': basis, 'sourceUpdatedAt': at(source), 'presentedAt': at(now),
                'routeIdentity': original['identity'], 'effectiveTransitRoute': copy.deepcopy(route), 'predictedArrivalAt': at(680)}}


class MixedPostdepartureEvidenceTest(unittest.TestCase):
    def test_both_orders_require_independently_qualified_forecasts_for_each_stage(self):
        for order in ('bus-rail', 'rail-bus'):
            for stage in ('INBOUND_CONNECTION', 'FINAL_ALIGHTING'):
                with self.subTest(order=order, stage=stage):
                    worker = fixture(order, stage)
                    observation = qualifying_mixed_observation(worker)
                    self.assertEqual(observation['mixedStage'], stage)
                    self.assertEqual(observation['predictedArrivalAt'], at(680))
                    self.assertNotIn('vehicleKey', str(observation))

    def test_bus_match_rejects_stale_ambiguous_occurrence_and_different_vehicle(self):
        for field, replacement in [('vehicleKey', '1' * 64), ('direction', 'up'),
                                   ('alighting', {'stationId': '100100103', 'arsId': '01002', 'order': 4})]:
            with self.subTest(field=field):
                worker = fixture('rail-bus', 'FINAL_ALIGHTING')
                worker['effectiveSnapshot']['plannedSeoulBusJourney']['rides'][0]['service'][field] = replacement
                self.assertIsNone(qualifying_mixed_observation(worker))
        worker = fixture('rail-bus', 'FINAL_ALIGHTING')
        worker['evaluatedAt'] = worker['mixedPredictionAtEvaluation']['presentedAt'] = at(550)
        self.assertIsNone(qualifying_mixed_observation(worker))

    def test_a_new_last_bus_stop_report_keeps_its_source_and_the_remaining_walk(self):
        worker = fixture('rail-bus', 'FINAL_ALIGHTING')
        state = worker['effectiveSnapshot']
        update = state['plannedRouteUpdate']
        update['reportedBusAlighting'] = {'routeIdentity': update['routeIdentity'], 'departureAt': at(0), 'sequence': 3,
            'service': state['plannedSeoulBusJourney']['rides'][0]['service'], 'reportedAt': at(490), 'checkedAt': at(495)}
        prediction = worker['mixedPredictionAtEvaluation']
        prediction.update(basis='FINAL_BUS_ALIGHTING_REPORTED', predictedArrivalAt=at(550))
        for route in (update['route'], prediction['effectiveTransitRoute']):
            route['arrivalAt'] = at(550)
            bus = route['segments'][3]['busRidePrediction']
            del bus['alightingObservationSourceUpdatedAt']
            bus.update(alightingAt=at(490), reportedAlightingAt=at(490))
        observation = qualifying_mixed_observation(worker)
        self.assertEqual(observation['mixedStage'], 'FINAL_ALIGHTING')
        self.assertEqual(observation['alightingEvidence'], 'STOP_REPORTED')
        self.assertEqual(observation['predictedArrivalAt'], at(550))
        worker['mixedPlanBeforeEvaluation']['route']['segments'][3]['busRidePrediction']['reportedAlightingAt'] = at(490)
        self.assertIsNone(qualifying_mixed_observation(worker))

    def test_rejects_changed_train_transfer_walk_and_unverifiable_public_projection(self):
        worker = fixture('bus-rail', 'FINAL_ALIGHTING')
        worker['effectiveSnapshot']['plannedRouteUpdate']['route']['segments'][3]['rideTiming']['timetable']['trainNumber'] = '4704'
        self.assertIsNone(qualifying_mixed_observation(worker))
        worker = fixture('rail-bus', 'INBOUND_CONNECTION')
        worker['effectiveSnapshot']['plannedRouteUpdate']['route']['segments'][3]['transferTiming']['confidenceReadyAt'] = at(290)
        self.assertIsNone(qualifying_mixed_observation(worker))
        worker = fixture('rail-bus', 'INBOUND_CONNECTION')
        worker['mixedPredictionAtEvaluation']['effectiveTransitRoute']['segments'][2]['durationSeconds'] = 10
        self.assertIsNone(qualifying_mixed_observation(worker))

    def test_windows_follow_saved_next_check_and_reconnected_final_vehicle(self):
        worker = fixture('bus-rail', 'INBOUND_CONNECTION')
        worker['nextCheckAt'] = at(110)
        route = worker['effectiveSnapshot']['inProgressPlannedRoute']
        first = mixed_observation_window(route, worker, evaluation_index=1, now=dt.datetime.fromisoformat(at(5)))
        self.assertEqual((first['mode'], first['at']), ('BUS', at(110)))
        saved = copy.deepcopy(route)
        saved['segments'][3]['rideTiming'].update(predictedBoardingAt=at(480), predictedArrivalAt=at(740))
        final = mixed_observation_window(saved, worker, evaluation_index=2, now=dt.datetime.fromisoformat(at(210)))
        self.assertEqual((final['mode'], final['at']), ('SUBWAY', at(500)))
        self.assertIsNone(mixed_observation_window(saved, worker, evaluation_index=3, now=dt.datetime.fromisoformat(at(210))))
        worker['targetArrivalAt'] = at(499)
        self.assertIsNone(mixed_observation_window(saved, worker, evaluation_index=2, now=dt.datetime.fromisoformat(at(210))))

    def test_ui_fallback_cannot_complete_the_mixed_audit(self):
        first = {'recommendedDepartureAt': at(0), 'automaticAlarmStateCount': 0, 'accepted': True}
        transfer = {**first, 'uiResult': 'PROVISIONAL_PASSED', 'mixedStage': 'INBOUND_CONNECTION', 'originSearchCalls': 0}
        final = {**transfer, 'mixedStage': 'FINAL_ALIGHTING'}
        self.assertEqual(mixed_postdeparture_audit([first, transfer, final])['result'], 'PASSED')
        self.assertEqual(mixed_postdeparture_audit([first, transfer, dict(final, uiResult='FALLBACK')])['result'], 'PARTIAL')
        self.assertEqual(mixed_postdeparture_audit([first, transfer, dict(final, originSearchCalls=1)])['result'], 'PARTIAL')
        self.assertEqual(mixed_postdeparture_audit([first, transfer, dict(final, recommendedDepartureAt=at(5))])['result'], 'PARTIAL')

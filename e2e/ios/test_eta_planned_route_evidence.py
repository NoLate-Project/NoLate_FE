import copy
import datetime as dt
import unittest
from eta_planned_route_evidence import (accepted_departure_plan, first_ride_intervals, transfer_ride_labels, fresh_final_alighting, planned_first_boarding_window, planned_observation_window, next_planned_observation_window, qualifying_planned_observation,
                                        verified_timetable_plan, verify_expired_plan_status)


class PlannedRouteEvidenceTest(unittest.TestCase):
    def test_first_boarding_scenario_can_use_its_last_round_for_the_actual_onward_train(self):
        worker = self.fixture()
        now = dt.datetime.fromisoformat(worker['evaluatedAt'])
        worker.update(nextCheckAt=now.isoformat(), targetArrivalAt='2026-11-19T13:00:00+00:00')
        current = qualifying_planned_observation(worker)['effectiveTransitRoute']
        first = next_planned_observation_window(current, worker, evaluation_index=2,
            first_boarding_recheck=True, now=now)
        final = next_planned_observation_window(current, worker, evaluation_index=2,
            first_boarding_recheck=True, first_boarding_followup='final-alighting', now=now)
        self.assertEqual((first['stage'], first['trainNumber']), ('FIRST_ALIGHTING', '4012'))
        self.assertEqual((final['stage'], final['trainNumber'], final['at']),
                         ('FINAL_ALIGHTING', '2014', '2026-11-19T12:25:41+00:00'))
        for index in (0, 3):
            with self.assertRaises(ValueError):
                next_planned_observation_window(current, worker, evaluation_index=index, now=now)
        with self.assertRaises(ValueError):
            next_planned_observation_window(current, worker, evaluation_index=2,
                first_boarding_followup='final-alighting', now=now)

    def test_first_boarding_recheck_is_after_the_nominal_window_and_preserves_real_due_time(self):
        worker = self.fixture()
        now = dt.datetime.fromisoformat(worker['evaluatedAt'])
        route = worker['effectiveSnapshot']['inProgressPlannedRoute']
        first = next(leg for leg in route['segments'] if leg['kind'] == 'SUBWAY')
        first['fromName'] = '노원'
        board = now + dt.timedelta(minutes=3)
        first['rideTiming'].update(predictedBoardingAt=board.isoformat(),
                                  predictedArrivalAt=(now + dt.timedelta(minutes=45)).isoformat())
        first['rideTiming']['timetable']['boardingAt'] = board.isoformat()
        worker.update(nextCheckAt=(now + dt.timedelta(minutes=1)).isoformat(),
                      targetArrivalAt=(now + dt.timedelta(minutes=90)).isoformat())
        window = planned_first_boarding_window(route, worker, now=now)
        self.assertEqual(window['stage'], 'FIRST_BOARDING_RECHECK')
        self.assertEqual(dt.datetime.fromisoformat(window['at']), board + dt.timedelta(seconds=121))
        worker['nextCheckAt'] = (now + dt.timedelta(minutes=7)).isoformat()
        self.assertEqual(planned_first_boarding_window(route, worker, now=now)['at'], worker['nextCheckAt'])
        worker['nextCheckAt'] = (board + dt.timedelta(minutes=20, seconds=1)).isoformat()
        self.assertIsNone(planned_first_boarding_window(route, worker, now=now))
        worker['nextCheckAt'] = now.isoformat()
        first['rideTiming']['predictedArrivalAt'] = (now + dt.timedelta(minutes=15)).isoformat()
        self.assertIsNone(planned_first_boarding_window(route, worker, now=now))
        self.assertIsNone(planned_first_boarding_window(None, worker, now=now))

    def test_carried_plan_can_only_add_the_verified_first_station_source(self):
        route = self.fixture()['effectiveSnapshot']['inProgressPlannedRoute']
        first = route['segments'][1]
        first['fromName'] = '노원'
        timing = first['rideTiming']
        timing['basis'] = 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
        timing['observationSourceUpdatedAt'] = None
        timing['timetable']['realtimeTrainNumber'] = '4607'
        observation = dict(provider='seoul-openapi', lineName='4호선', stationName='노원', trainNumber='4607',
                           departureAt=route['departureAt'], expectedBoardingAt=timing['predictedBoardingAt'],
                           sourceUpdatedAt='2026-11-19T12:00:00Z', evaluatedAt='2026-11-19T12:01:50Z')
        snapshot = dict(accepted=True, effectiveTransitRoute=route, firstBoardingObservation=observation)
        expected = copy.deepcopy(route)
        expected['segments'][1]['rideTiming'].update(basis='PLANNED_RIDE_BOARDING_REALTIME',
                                                     observationSourceUpdatedAt=observation['sourceUpdatedAt'])
        self.assertEqual(accepted_departure_plan(snapshot), expected)
        for key, bad in [('trainNumber', '4001'), ('lineName', '2호선'), ('stationName', '사당'),
                         ('sourceUpdatedAt', '2026-11-19T11:59:49Z'), ('expectedBoardingAt', route['departureAt'])]:
            self.assertEqual(accepted_departure_plan(dict(snapshot, firstBoardingObservation={**observation, key: bad})), route)
        timing.update(basis='FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME', observationSourceUpdatedAt=observation['evaluatedAt'])
        paired = accepted_departure_plan(snapshot)['segments'][1]['rideTiming']
        self.assertEqual(paired['boardingObservationSourceUpdatedAt'], observation['sourceUpdatedAt'])
        self.assertEqual(paired['observationSourceUpdatedAt'], observation['evaluatedAt'])

    def test_first_wait_uses_exact_access_and_same_ride_clocks(self):
        route = self.fixture()['effectiveSnapshot']['inProgressPlannedRoute']
        self.assertEqual(first_ride_intervals(route), {
            'wait': '첫 승차 대기 약 1분 (열차 도착 기준)', 'ride': '승차역부터 하차역까지 약 5분 3초', 'inclusiveMinutes': 7})
        route['segments'][1]['rideTiming']['basis'] = 'TIMETABLE'
        self.assertIn('열차 출발 기준', first_ride_intervals(route)['wait'])
        del route['segments'][0]['durationSeconds']
        self.assertIsNone(first_ride_intervals(route))

    def test_transfer_components_use_the_following_train_and_exclude_rounded_walks(self):
        route = self.fixture()['effectiveSnapshot']['inProgressPlannedRoute']
        self.assertEqual(transfer_ride_labels(route), [
            '환승 대기 약 4분 4초 · 승차역부터 하차역까지 약 8분 1초 · 2012열차'])
        del route['segments'][2]['durationSeconds']
        self.assertEqual(transfer_ride_labels(route), [])

    def fixture(self):
        epoch = dt.datetime(2026, 11, 19, 12, tzinfo=dt.timezone.utc)
        at = lambda seconds: (epoch + dt.timedelta(seconds=seconds)).isoformat()
        def walk(sequence, seconds):
            return {'sequence': sequence, 'kind': 'WALK', 'durationSeconds': seconds, 'durationMinutes': (seconds + 59) // 60}
        def ride(sequence, train, board, alight, basis, source=None):
            table = {'provider': 'seoul-timetable', 'line': 'LINE_4' if sequence == 1 else 'LINE_2',
                     'serviceDate': '2026-11-19', 'trainNumber': train, 'directionCode': 'DOWN',
                     'serviceClass': 'LOCAL', 'fromStationCode': 'N' if sequence == 1 else 'S2',
                     'toStationCode': 'S4' if sequence == 1 else 'L'}
            table.update(boardingAt=at(board), arrivalAt=at(alight))
            return {'sequence': sequence, 'kind': 'SUBWAY', 'toName': table['toStationCode'], 'rideTiming': {'timetable': table,
                    'basis': basis, 'observationSourceUpdatedAt': source,
                    'predictedBoardingAt': at(board), 'predictedArrivalAt': at(alight)}}
        route = {'provider': 'odsay', 'identity': 'a' * 64, 'departureAt': at(39), 'arrivalAt': at(1952),
                 'segments': [walk(0, 111), ride(1, '4012', 210, 700, 'PLANNED_RIDE_ALIGHTING_REALTIME', at(300)),
                              walk(2, 243), ride(3, '2014', 1300, 1781, 'TIMETABLE'), walk(4, 171)]}
        route['segments'][3]['transferTiming'] = {'previousArrivalAt': at(700), 'walkingSeconds': 243,
                                                'requiredMarginSeconds': 60}
        plan = copy.deepcopy(route)
        plan['arrivalAt'] = at(1652)
        plan['segments'][1] = ride(1, '4012', 210, 513, 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE')
        plan['segments'][3] = ride(3, '2012', 1000, 1481, 'TIMETABLE')
        return {'evaluatedAt': at(300), 'effectiveSnapshot': {'inProgressPlannedRoute': plan,
                'plannedRouteUpdate': {'routeIdentity': route['identity'], 'sourceUpdatedAt': at(300),
                                       'route': route, 'failure': None, 'onlyLastRideObserved': False}}}

    def test_first_ride_observation_and_new_onward_timetable_are_qualifying(self):
        worker = self.fixture()
        result = qualifying_planned_observation(worker)
        self.assertEqual(result['basis'], 'MATCHED_RIDE_AND_ONWARD_TIMETABLE')
        self.assertEqual(result['effectiveTransitRoute']['segments'][3]['rideTiming']['timetable']['trainNumber'], '2014')
        self.assertEqual(result['predictedArrivalAt'], '2026-11-19T12:32:32+00:00')

    def test_last_window_follows_the_reconnected_train_and_persisted_due_time(self):
        worker = self.fixture()
        now = dt.datetime.fromisoformat(worker['evaluatedAt'])
        worker.update(nextCheckAt=now.isoformat(), targetArrivalAt='2026-11-19T13:00:00+00:00')
        result = qualifying_planned_observation(worker)
        original = worker['effectiveSnapshot']['inProgressPlannedRoute']
        self.assertIsNone(fresh_final_alighting(result, original, worker['evaluatedAt']))
        current = result['effectiveTransitRoute']
        window = planned_observation_window(current, worker, final=True, now=now)
        self.assertEqual((window['trainNumber'], window['at']), ('2014', '2026-11-19T12:25:41+00:00'))
        self.assertEqual(planned_observation_window(original, worker, final=False, now=now)['trainNumber'], '4012')
        worker['nextCheckAt'] = '2026-11-19T12:26:00+00:00'
        self.assertEqual(planned_observation_window(current, worker, final=True, now=now)['at'], worker['nextCheckAt'])
        worker['nextCheckAt'] = window['predictedArrivalAt']
        self.assertIsNone(planned_observation_window(current, worker, final=True, now=now))

    def test_final_station_requires_a_new_direct_forecast_for_the_previously_selected_train(self):
        worker = self.fixture()
        update = worker['effectiveSnapshot']['plannedRouteUpdate']
        prior = copy.deepcopy(update['route'])
        now = '2026-11-19T12:26:00+00:00'
        worker['evaluatedAt'] = update['sourceUpdatedAt'] = now
        update['route']['segments'][1]['rideTiming'].update(basis='PLANNED_RIDE_BASELINE', observationSourceUpdatedAt=None)
        last = update['route']['segments'][3]['rideTiming']
        last.update(basis='PLANNED_RIDE_ALIGHTING_REALTIME', observationSourceUpdatedAt=now)
        observation = qualifying_planned_observation(worker)
        self.assertEqual(fresh_final_alighting(observation, prior, now)['trainNumber'], '2014')
        original = worker['effectiveSnapshot']['inProgressPlannedRoute']
        self.assertIsNone(fresh_final_alighting(observation, original, now))
        self.assertIsNone(fresh_final_alighting(observation, update['route'], now))
        prior_boarding = copy.deepcopy(prior)
        prior_boarding['segments'][3]['rideTiming'].update(basis='PLANNED_RIDE_BOARDING_REALTIME', observationSourceUpdatedAt=now)
        self.assertEqual(fresh_final_alighting(observation, prior_boarding, now)['trainNumber'], '2014')
        self.assertIsNone(fresh_final_alighting(observation, prior, '2026-11-19T12:28:01+00:00'))
        last['basis'] = 'PLANNED_RIDE_BOARDING_REALTIME'
        self.assertIsNone(fresh_final_alighting(observation, prior, now))

    def test_fresh_alighting_does_not_hide_an_expired_boarding_source(self):
        worker = self.fixture()
        timing = worker['effectiveSnapshot']['plannedRouteUpdate']['route']['segments'][1]['rideTiming']
        timing['boardingObservationSourceUpdatedAt'] = '2026-11-19T12:02:59+00:00'
        self.assertIsNone(qualifying_planned_observation(worker))

    def test_stale_source_changed_boundary_or_infeasible_transfer_cannot_pass(self):
        def set_path(value, path, replacement):
            for key in path[:-1]: value = value[key]
            value[path[-1]] = replacement
        base = ('effectiveSnapshot', 'plannedRouteUpdate')
        for path, replacement in (
            (base + ('failure',), 'TRANSFER_RECONNECTION_UNAVAILABLE'),
            (base + ('routeIdentity',), 'b' * 64),
            (base + ('sourceUpdatedAt',), '2026-11-19T12:02:59+00:00'),
            (base + ('sourceUpdatedAt',), '2026-11-19T12:05:06+00:00'),
            (base + ('route', 'departureAt'), '2026-11-19T12:01:39+00:00'),
            (base + ('route', 'arrivalAt'), '2026-11-19T12:33:32+00:00'),
            (base + ('route', 'segments', 2, 'durationSeconds'), 200),
            (base + ('route', 'segments', 1, 'rideTiming', 'observationSourceUpdatedAt'), '2026-11-19T12:02:59+00:00'),
            (base + ('route', 'segments', 3, 'rideTiming', 'timetable', 'fromStationCode'), 'WRONG'),
            (base + ('route', 'segments', 3, 'rideTiming', 'predictedBoardingAt'), '2026-11-19T12:16:40+00:00'),
        ):
            with self.subTest(path=path):
                worker = self.fixture()
                set_path(worker, path, replacement)
                self.assertIsNone(qualifying_planned_observation(worker))

    def test_early_boarding_is_evidence_for_boarding_only(self):
        worker = self.fixture()
        update = worker['effectiveSnapshot']['plannedRouteUpdate']
        timing = update['route']['segments'][1]['rideTiming']
        timing['basis'] = 'FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING'
        timing['timetable'].update(boardingStationArrivalAt='2026-11-19T12:04:30+00:00',
                                  arrivalAt=timing['predictedArrivalAt'])
        self.assertEqual(qualifying_planned_observation(worker)['basis'], 'MATCHED_RIDE_AND_ONWARD_TIMETABLE')
        timing['timetable']['arrivalAt'] = '2026-11-19T12:11:41+00:00'
        self.assertIsNone(qualifying_planned_observation(worker))
        timing['timetable']['arrivalAt'] = timing['predictedArrivalAt']
        timing['observationSourceUpdatedAt'] = None
        self.assertIsNone(qualifying_planned_observation(worker))

    def test_timetable_alone_is_not_a_direct_observation(self):
        worker = self.fixture()
        worker['effectiveSnapshot']['plannedRouteUpdate']['route']['segments'][1]['rideTiming']['basis'] = 'PLANNED_RIDE_BASELINE'
        self.assertIsNone(qualifying_planned_observation(worker))

    def test_early_transfer_boarding_keeps_timetable_alighting_and_cannot_count_as_a_live_final(self):
        worker = self.fixture()
        update = worker['effectiveSnapshot']['plannedRouteUpdate']
        prior = copy.deepcopy(update['route'])
        timing = update['route']['segments'][3]['rideTiming']
        timing.update(basis='TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING',
                      predictedBoardingAt='2026-11-19T12:20:30+00:00',
                      observationSourceUpdatedAt=worker['evaluatedAt'])
        timing['timetable']['boardingStationArrivalAt'] = '2026-11-19T12:21:00+00:00'
        result = qualifying_planned_observation(worker)
        self.assertEqual(result['basis'], 'MATCHED_RIDE_AND_ONWARD_TIMETABLE')
        self.assertIsNone(fresh_final_alighting(result, prior, worker['evaluatedAt']))
        update['onlyLastRideObserved'] = True
        self.assertIsNone(qualifying_planned_observation(worker))
        update['onlyLastRideObserved'] = False
        timing['predictedArrivalAt'] = '2026-11-19T12:29:00+00:00'
        self.assertIsNone(qualifying_planned_observation(worker))
        timing['predictedArrivalAt'] = timing['timetable']['arrivalAt']
        timing['observationSourceUpdatedAt'] = None
        self.assertIsNone(qualifying_planned_observation(worker))

    def test_legacy_last_ride_remains_supported_without_hiding_a_known_failure(self):
        worker = self.fixture()
        snapshot = worker['effectiveSnapshot']
        snapshot['plannedArrivalObservation'] = {'routeIdentity': 'a' * 64,
            'sourceUpdatedAt': worker['evaluatedAt'], 'predictedArrivalAt': '2026-11-19T12:32:32+00:00'}
        snapshot['plannedRouteUpdate']['failure'] = 'TRANSFER_RECONNECTION_UNAVAILABLE'
        self.assertIsNone(qualifying_planned_observation(worker))
        del snapshot['plannedRouteUpdate']
        self.assertEqual(qualifying_planned_observation(worker)['basis'], 'MATCHED_TRAIN_REALTIME')

    def test_verified_future_timetable_can_be_a_plan_without_becoming_live(self):
        worker = self.fixture()
        plan = copy.deepcopy(worker['effectiveSnapshot']['inProgressPlannedRoute'])
        worker['evaluatedAt'] = '2026-11-19T12:00:00+00:00'
        worker['targetArrivalAt'] = '2026-11-19T13:00:00+00:00'
        for s in plan['segments']:
            if s['kind'] == 'SUBWAY':
                timing = s['rideTiming']
                timing['basis'] = 'TIMETABLE'
                timing['timetable'].update(boardingAt=timing['predictedBoardingAt'],
                    arrivalAt=timing['predictedArrivalAt'], fetchedAt=worker['evaluatedAt'])
        worker.update(source='TIMETABLE_PROVIDER', stale=True,
            failureReason='TRANSIT_TRAIN_NOT_YET_OBSERVED: safe', effectiveSnapshot={
                'accepted': False, 'transitTimingBasis': 'TIMETABLE_ONLY',
                'lastTimetablePlannedRoute': plan, 'effectiveTransitRoute': copy.deepcopy(plan)})
        self.assertEqual(verified_timetable_plan(worker), plan)
        self.assertIsNone(qualifying_planned_observation(worker))
        for key, value in (('source', 'SELECTED_ROUTE'), ('failureReason', 'PROVIDER_TIMEOUT: safe'),
                           ('evaluatedAt', '2026-11-19T12:02:00+00:00')):
            with self.subTest(key=key):
                self.assertIsNone(verified_timetable_plan(dict(worker, **{key: value})))

    def test_expired_plan_read_keeps_new_train_and_cannot_restore_realtime_fields(self):
        worker = self.fixture()
        snapshot = worker['effectiveSnapshot']
        snapshot['lastUpdatedPlannedRoute'] = snapshot['plannedRouteUpdate']['route']
        worker.update(recommendedDepartureAt='2026-11-19T12:00:00+00:00',
            etaRefreshDueAt='2026-11-19T12:06:00+00:00', etaSnapshotGraceMinutes=5)
        route = copy.deepcopy(snapshot['lastUpdatedPlannedRoute'])
        route['segments'][1]['rideTiming'].update(basis='PLANNED_RIDE_BASELINE', observationSourceUpdatedAt=None)
        public = dict(stale=True, confidence='LOW', recommendedDepartureAt=worker['recommendedDepartureAt'],
            evaluatedAt='2026-11-19T12:11:02+00:00', originReplanDiagnostic={'failureReason':'ETA_SNAPSHOT_EXPIRED: safe'},
            plannedJourneyArrivalPrediction={'basis':'LAST_ACCEPTED_PLAN', 'sourceUpdatedAt':None,
                'routeIdentity':route['identity'], 'predictedArrivalAt':route['arrivalAt'], 'effectiveTransitRoute':route})
        self.assertTrue(verify_expired_plan_status(worker, public)['expiredObservationsNotPromoted'])
        for key, value in (('source','LIVE_PROVIDER'), ('predictedArrivalAt',route['arrivalAt']),
                           ('recommendedDepartureAt','2026-11-19T12:10:00+00:00'),
                           ('evaluatedAt','2026-11-19T12:10:59+00:00')):
            with self.subTest(key=key), self.assertRaises(AssertionError):
                verify_expired_plan_status(worker, dict(public, **{key:value}))
        route['segments'][1]['rideTiming']['basis'] = 'PLANNED_RIDE_ALIGHTING_REALTIME'
        with self.assertRaises(AssertionError):
            verify_expired_plan_status(worker, public)

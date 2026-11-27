import copy
import datetime as dt
import unittest

from eta_train_position_slots import JourneyPositionSlots, MAX_READS


UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 19, 14, 3, tzinfo=UTC)


def at(minutes):
    return (NOW + dt.timedelta(minutes=minutes)).isoformat()


def fixture():
    def ride(line, start, end, first_id, last_id, train, board, arrival):
        table = dict(provider='seoul-timetable', line=line, fromStationCode=first_id, toStationCode=last_id,
                     trainNumber=train, serviceDate='2026-11-19', directionCode='DOWN' if line == 'LINE_4' else 'UP',
                     terminalName='금정' if line == 'LINE_4' else '신도림', serviceClass='LOCAL',
                     fetchedAt=at(-1), boardingAt=at(board), arrivalAt=at(arrival))
        return dict(kind='SUBWAY', fromName=start, toName=end, rideTiming=dict(timetable=table, basis='TIMETABLE',
                                                                              predictedBoardingAt=at(board), predictedArrivalAt=at(arrival)))
    route = dict(provider='odsay', identity='selected', departureAt=at(8), arrivalAt=at(76), segments=[
        ride('LINE_4', '노원', '사당', '0411', '0433', 'K4335', 15, 63),
        ride('LINE_2', '사당', '신림', '0226', '0230', '2510', 67, 74)])
    return dict(classification='REAL_PROVIDER_ISOLATED_WORKER', providersMocked=False, database='H2_MEMORY_ONLY',
                clockMode='SYSTEM_WALL_CLOCK', journeyProvider='odsay', evaluatedAt=at(0), targetArrivalAt=at(85),
                source='TIMETABLE_PROVIDER', stale=True, failureReason='TRANSIT_TRAIN_NOT_YET_OBSERVED',
                effectiveSnapshot=dict(transitTimingBasis='TIMETABLE_ONLY', transitRouteProvenance='SELECTED_ROUTE_PRESERVED',
                                       routeChanged=False, accepted=False,
                                       lastTimetablePlannedRoute=route, effectiveTransitRoute=route))


class PositionSlotsTest(unittest.TestCase):
    def setUp(self):
        self.slots = JourneyPositionSlots()
        self.worker = fixture()
        self.route = self.worker['effectiveSnapshot']['effectiveTransitRoute']
        self.slots.apply_evaluation(1, self.worker, NOW)

    def test_all_four_station_events_are_bracketed_with_one_journey_budget(self):
        self.assertEqual(len(self.slots.pending), MAX_READS)
        for event in {(s['event'], s['line']) for s in self.slots.pending.values()}:
            rows = [s for s in self.slots.pending.values() if (s['event'], s['line']) == event]
            self.assertEqual([int((s['at'] - dt.datetime.fromisoformat(s['predictedAt'])).total_seconds()) for s in rows],
                             [-120, -15, 90, 195])
        self.assertIsNone(self.slots.take_due(NOW))
        for slot in sorted(self.slots.pending.values(), key=lambda s: s['at']):
            record = self.slots.take_due(slot['at'])
            self.assertEqual(record['line'], slot['line'])
            self.slots.last_receipt[slot['line']] = slot['at']
        self.assertFalse(self.slots.pending)
        self.assertEqual(len(self.slots.log), 16)

    def test_fixed_future_departure_does_not_lose_the_final_alighting_window(self):
        early_evaluation = NOW - dt.timedelta(minutes=18)
        self.worker['evaluatedAt'] = early_evaluation.isoformat()
        for leg in self.route['segments']:
            leg['rideTiming']['timetable']['fetchedAt'] = early_evaluation.isoformat()
        slots = JourneyPositionSlots()
        slots.apply_evaluation(1, self.worker, early_evaluation)
        final = [s['at'] for s in slots.pending.values() if s['event'] == 'ALIGHTING' and s['line'] == 'LINE_2']
        self.assertGreater(max(final), early_evaluation + dt.timedelta(minutes=90))
        self.assertLessEqual(max(final), dt.datetime.fromisoformat(self.route['departureAt']) + dt.timedelta(minutes=90))
        self.assertEqual(len(slots.pending), MAX_READS)

    def test_public_short_corridor_tracks_dongjak_instead_of_reusing_nowon(self):
        first = self.route['segments'][0]
        first['fromName'] = '동작'
        first['rideTiming']['timetable']['fromStationCode'] = '0431'
        with self.assertRaisesRegex(ValueError, 'Unexpected observation corridor'):
            JourneyPositionSlots().apply_evaluation(1, self.worker, NOW)
        slots = JourneyPositionSlots(short_corridor=True)
        slots.apply_evaluation(1, self.worker, NOW)
        first_boarding = [slot for slot in slots.pending.values()
                          if slot['line'] == 'LINE_4' and slot['event'] == 'BOARDING']
        self.assertEqual({slot['station'] for slot in first_boarding}, {'동작'})
        self.assertEqual(len(slots.pending), MAX_READS)

    def test_reconnected_train_only_changes_unspent_future_windows(self):
        old = sorted(self.slots.pending.values(), key=lambda s: s['at'])
        for slot in old[:5]:
            self.slots.take_due(slot['at'])
        next_route = copy.deepcopy(self.route)
        timing = next_route['segments'][-1]['rideTiming']
        timing['timetable']['trainNumber'] = '2512'
        timing.update(predictedBoardingAt=at(71), predictedArrivalAt=at(78))
        snapshot = self.worker['effectiveSnapshot']
        snapshot.update(inProgressPlannedRoute=self.route, lastUpdatedPlannedRoute=next_route)
        self.worker['evaluatedAt'] = at(62)
        self.slots.apply_evaluation(2, self.worker, dt.datetime.fromisoformat(at(62)))
        self.assertEqual(len(self.slots.spent), 5)
        self.assertTrue(all(s['trainNumber'] == '2512' for s in self.slots.pending.values() if s['line'] == 'LINE_2'))
        self.assertTrue(all(s['evaluation'] == 1 for s in self.slots.log))
        self.assertEqual(len(self.slots.pending) + len(self.slots.spent), 16)

    def test_cached_and_expired_requests_are_not_caught_up(self):
        first, second = sorted(self.slots.pending.values(), key=lambda s: s['at'])[:2]
        self.slots.last_receipt['LINE_4'] = second['at'] - dt.timedelta(seconds=30)
        self.assertIsNone(self.slots.take_due(second['at']))
        self.assertEqual([s['status'] for s in self.slots.log], ['MISSED_CLOCK_WINDOW', 'INSIDE_PROVIDER_CACHE'])
        self.assertNotIn((first['line'], first['event'], first['ordinal']), self.slots.pending)

    def test_warning_preserves_only_the_previous_predictions_remaining_observation_slots(self):
        snapshot = self.worker['effectiveSnapshot']
        snapshot.update(inProgressPlannedRoute=self.route,
                        plannedRouteUpdate=dict(routeIdentity=self.route['identity'], failure='EARLY_BOARDING_UNCONFIRMED'))
        first = min(s['at'] for s in self.slots.pending.values())
        self.slots.take_due(first)
        remaining = self.slots.pending.copy()
        self.slots.apply_evaluation(2, self.worker, first)
        self.assertEqual(self.slots.pending, remaining)
        self.assertEqual(len(self.slots.plans), 1)
        for slot in sorted(remaining.values(), key=lambda s: s['at']):
            self.assertEqual(self.slots.take_due(slot['at'])['evaluation'], 1)
        self.assertEqual(len(self.slots.spent), MAX_READS)

    def test_warning_from_a_different_journey_cannot_keep_observation_running(self):
        self.worker['effectiveSnapshot'].update(inProgressPlannedRoute=self.route,
            plannedRouteUpdate=dict(routeIdentity='different', failure='EARLY_BOARDING_UNCONFIRMED'))
        self.slots.apply_evaluation(2, self.worker, NOW)
        self.assertFalse(self.slots.pending)
        self.worker['effectiveSnapshot'].update(plannedRouteUpdate=None, lastUpdatedPlannedRoute=self.route)
        self.slots.apply_evaluation(3, self.worker, NOW)
        self.assertFalse(self.slots.pending)

    def test_no_queries_for_rejected_unproven_or_changed_route(self):
        for field in ('failureReason', 'stale'):
            unproven = dict(self.worker, **{field: None})
            slots = JourneyPositionSlots()
            slots.apply_evaluation(1, unproven, NOW)
            self.assertFalse(slots.pending)
        self.worker['effectiveSnapshot']['routeChanged'] = True
        self.slots.apply_evaluation(2, self.worker, NOW)
        self.assertFalse(self.slots.pending)

    def test_invalid_station_or_future_worker_snapshot_rejected(self):
        self.route['segments'][1]['rideTiming']['timetable']['fromStationCode'] = 'not-사당'
        with self.assertRaises(ValueError):
            self.slots.apply_evaluation(1, self.worker, NOW)
        with self.assertRaises(ValueError):
            self.slots.apply_evaluation(1, self.worker, NOW - dt.timedelta(seconds=1))

    def test_official_dated_train_can_be_observed_without_inferred_aliases(self):
        table = self.route['segments'][0]['rideTiming']['timetable']
        table.update(provider='seoul-dated-path', trainNumber='4195')
        slots = JourneyPositionSlots()
        slots.apply_evaluation(1, self.worker, NOW)
        self.assertEqual({s['trainNumber'] for s in slots.pending.values() if s['line'] == 'LINE_4'}, {'4195'})
        table['realtimeTrainNumber'] = 'K4195'
        with self.assertRaisesRegex(ValueError, 'Unverified realtime train number'):
            JourneyPositionSlots().apply_evaluation(1, self.worker, NOW)

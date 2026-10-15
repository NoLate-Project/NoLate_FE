"""Verifier regression only; actual E2E evidence comes from the real runner."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('automatic_delivery', Path(__file__).with_name('run-eta-automatic-delivery.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def evaluation():
    saved = {'memberId': 296, 'scheduleId': 363, 'targetArrivalAt': '2026-10-13T04:00:00Z'}
    return {'database': 'H2_MEMORY_ONLY', 'providersMocked': False, 'automaticScheduling': True,
            'clockMode': 'SYSTEM_WALL_CLOCK', 'executionThread': 'nolate-scheduler-1',
            'successfulUiCreateCount': 1, 'processed': 1, 'alertMode': 'ALARM',
            'savedScheduleInput': saved, 'savedScheduleAfterEvaluation': dict(saved),
            'historyCount': 1, 'evaluatedAt': '2026-10-13T02:50:00Z', 'nextCheckAt': '2026-10-13T02:51:00Z',
            'source': 'LIVE_PROVIDER', 'stale': False, 'failureReason': None, 'effectiveSnapshot': {'accepted': True}}


class AutomaticDeliveryVerifierTest(unittest.TestCase):
    def test_unobserved_future_train_waits_on_actual_clock_without_more_calls(self):
        value = evaluation()
        value.update(failureReason='TRANSIT_TRAIN_NOT_YET_OBSERVED: fixture',
                     targetArrivalAt='2026-10-13T04:00:00Z', journeyTimingTrace={'events': [{
                         'method': 'enrich', 'arrivalAt': '2026-10-13T03:59:00Z',
                         'legs': [{'mode': 'SUBWAY', 'timetable': {'boardingAt': '2026-10-13T03:10:00Z'}}]}]})
        before = copy.deepcopy(value)
        now = dt.datetime.fromisoformat('2026-10-13T03:00:00+00:00')
        self.assertEqual(dt.datetime.fromisoformat('2026-10-13T03:04:00+00:00'),
                         runner.next_observation_window(value, now))
        self.assertEqual(before, value)
        later = copy.deepcopy(value['journeyTimingTrace']['events'][0])
        later['legs'][0]['timetable']['boardingAt'] = '2026-10-13T03:20:00Z'
        value['journeyTimingTrace']['events'].append(later)
        # The 03:10 train is still future and its 03:04 window has opened.
        # Do not skip it and wait for the later train's 03:14 window.
        self.assertIsNone(runner.next_observation_window(value,
            dt.datetime.fromisoformat('2026-10-13T03:05:00+00:00')))
        value['journeyTimingTrace']['events'].pop()
        value['failureReason'] = 'HTTP_QUOTA: fixture'
        self.assertIsNone(runner.next_observation_window(value, now))
        value['failureReason'] = 'TRANSIT_TRAIN_NOT_YET_OBSERVED: fixture'
        value['journeyTimingTrace']['events'][0]['arrivalAt'] = '2026-10-13T04:01:00Z'
        self.assertIsNone(runner.next_observation_window(value, now))

    def test_actual_saved_coordinates_provider_and_transfer_are_required(self):
        route = {'provider': 'tmap', 'transitLegs': [
            {'kind': 'SUBWAY', 'lineName': '수도권4호선', 'startName': '노원', 'endName': '사당'},
            {'kind': 'WALK'},
            {'kind': 'SUBWAY', 'lineName': '수도권2호선', 'startName': '사당', 'endName': '신림'}]}
        saved = {'originLat': 37.65636195, 'originLng': 127.06342739,
                 'destinationLat': 37.48426844, 'destinationLng': 126.92977778,
                 'routeJson': json.dumps(route)}
        runner.verify_saved_route(saved, 'tmap')
        with self.assertRaises(AssertionError):
            runner.verify_saved_route(saved, 'odsay')
        with self.assertRaises(AssertionError):
            runner.verify_saved_route(dict(saved, originLat=37.65), 'tmap')
        route['transitLegs'][0]['endName'] = '동대문역사문화공원'
        with self.assertRaises(AssertionError):
            runner.verify_saved_route(dict(saved, routeJson=json.dumps(route)), 'tmap')

    def test_manual_or_synthetic_or_uncreated_schedule_cannot_pass(self):
        runner.verify_automatic(evaluation())
        for key, value in [('executionThread', 'main'), ('providersMocked', True), ('automaticScheduling', False),
                           ('database', 'MYSQL'), ('successfulUiCreateCount', 0), ('alertMode', 'STANDARD')]:
            changed = evaluation()
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                runner.verify_automatic(changed)

    def test_repeated_evaluation_requires_persisted_due_and_new_history(self):
        previous = evaluation()
        current = copy.deepcopy(previous)
        current.update(historyCount=2, evaluatedAt=previous['nextCheckAt'])
        runner.verify_automatic(current, previous)
        for key, value in [('historyCount', 1), ('evaluatedAt', previous['evaluatedAt'])]:
            changed = copy.deepcopy(current)
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                runner.verify_automatic(changed, previous)

    def test_diagnostic_is_never_accepted_realtime(self):
        self.assertTrue(runner.accepted(evaluation()))
        for key, value in [('source', 'TIMETABLE_PROVIDER'), ('stale', True), ('failureReason', 'UNOBSERVED'),
                           ('effectiveSnapshot', {'accepted': False})]:
            changed = evaluation()
            changed[key] = value
            self.assertFalse(runner.accepted(changed))


if __name__ == '__main__':
    unittest.main()

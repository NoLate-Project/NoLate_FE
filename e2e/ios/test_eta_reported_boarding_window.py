import copy
import datetime as dt
import unittest
from eta_reported_boarding_window import next_reported_boarding_window, require_public_comparison_departure

BASE = dt.datetime(2026, 11, 20, 9, tzinfo=dt.timezone.utc)
def at(seconds): return (BASE + dt.timedelta(seconds=seconds)).isoformat()
def plan():
    return {'identity': 'a'*64, 'departureAt': at(0), 'segments': [
        {'kind': 'SUBWAY', 'sequence': 1, 'fromName': '노원', 'toName': '사당', 'rideTiming':
            {'predictedBoardingAt': at(180), 'predictedArrivalAt': at(3060)}},
        {'kind': 'SUBWAY', 'sequence': 3, 'fromName': '사당', 'toName': '신림', 'rideTiming':
            {'predictedBoardingAt': at(3600), 'predictedArrivalAt': at(4050)}}]}
def worker(): return {'nextCheckAt': at(60), 'targetArrivalAt': at(4800), 'evaluatedAt': at(-60)}

class ReportedBoardingWindowTest(unittest.TestCase):
    def test_public_map_input_is_selectable_before_any_provider_process_starts(self):
        self.assertEqual(require_public_comparison_departure('2026-11-20T19:10:00+09:00').minute, 10)
        for value in ('2026-11-20T19:05:00+09:00', '2026-11-20T19:10:01+09:00', '2026-11-20T19:10:00'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                require_public_comparison_departure(value)

    def test_two_declared_real_waits_leave_time_for_the_destination_forecast(self):
        p, w = plan(), worker()
        first = next_reported_boarding_window(p, w, evaluation_index=1, now=BASE)
        self.assertEqual(first['at'], at(3630))
        w.update(nextCheckAt=at(3690), evaluatedAt=at(3630), effectiveSnapshot={'plannedRouteUpdate': {'reportedBoardings':[
            {'routeIdentity':p['identity'],'routeDepartureAt':p['departureAt'],'segmentSequence':3,'checkedAt':at(3630)}]}})
        second = next_reported_boarding_window(p, w, evaluation_index=2, now=BASE+dt.timedelta(seconds=3660))
        self.assertEqual(second['at'], at(3930))
        self.assertFalse(second['qualifyingNaturalObservationGuaranteed'])
        self.assertEqual(p, plan())
    def test_no_unbounded_late_boarding_search(self):
        self.assertIsNone(next_reported_boarding_window(plan(), worker(), evaluation_index=1, now=BASE+dt.timedelta(seconds=3721)))
        with self.assertRaises(ValueError): next_reported_boarding_window(plan(), worker(), evaluation_index=3, now=BASE)
    def test_due_and_target_are_respected_without_overwriting_them(self):
        w=worker();w['nextCheckAt']=at(3700)
        self.assertEqual(next_reported_boarding_window(plan(), w, evaluation_index=1, now=BASE)['at'],at(3700))
        w['targetArrivalAt']=at(3740)
        self.assertIsNone(next_reported_boarding_window(plan(),w,evaluation_index=1,now=BASE))
    def test_missing_pending_record_does_not_fabricate_one_or_promise_success(self):
        w=worker();w.update(evaluatedAt=at(3630),nextCheckAt=at(3690));original=copy.deepcopy(w)
        self.assertEqual(next_reported_boarding_window(plan(),w,evaluation_index=2,now=BASE)['at'],at(3930))
        self.assertEqual(w,original)

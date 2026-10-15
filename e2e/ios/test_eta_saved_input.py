import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('saved_input', Path(__file__).with_name('verify-eta-saved-input.py'))
saved_input = importlib.util.module_from_spec(spec)
spec.loader.exec_module(saved_input)


class SavedInputTest(unittest.TestCase):
    def setUp(self):
        self.target = '2026-10-05T12:20:00Z'
        value = {'scheduleId': 363, 'memberId': 296, 'targetArrivalAt': self.target,
                 'originLat': 37.6551, 'originLng': 127.061, 'destinationLat': 37.4842,
                 'destinationLng': 126.9297, 'travelMode': 'TRANSIT',
                 'selectedRouteJson': json.dumps({'provider': 'tmap'})}
        self.saved = {'savedScheduleInput': value, 'successfulUiSaveCount': 1}
        self.worker = {
            'savedScheduleInput': copy.deepcopy(value), 'savedScheduleAfterEvaluation': copy.deepcopy(value),
            'successfulUiSaveCount': 1, 'targetArrivalAt': self.target,
            'evaluatedAt': '2026-10-05T11:00:01Z', 'epoch': '2026-10-05T11:01:00Z',
            'evaluationHistory': {'scheduleId': 363, 'memberId': 296, 'targetArrivalAt': self.target,
                                  'evaluatedAt': '2026-10-05T11:00:02Z'},
            'routeRequests': [{'startX': 127.061, 'startY': 37.6551, 'endX': 126.9297,
                               'endY': 37.4842, 'searchDttm': '202610052001'}],
            'processed': 1, 'phase': 'success', 'effectiveSnapshot': {'accepted': True},
            'source': 'LIVE_PROVIDER', 'failureCode': None, 'stale': False,
            'recommendedDepartureAt': '2026-10-05T11:01:00Z',
            'predictedArrivalAt': '2026-10-05T11:41:52Z', 'alarmStates': [{'operation': 'UPSERT'}],
        }

    def verify(self):
        saved_input.verify_worker(self.saved, self.worker, self.target)

    def test_valid_saved_input(self):
        self.verify()

    def test_new_creation_requires_post_once_and_no_put(self):
        self.saved['successfulUiSaveCount'] = self.worker['successfulUiSaveCount'] = 0
        self.saved['successfulUiCreateCount'] = self.worker['successfulUiCreateCount'] = 1
        saved_input.verify_worker(self.saved, self.worker, self.target, operation='create')
        for creates, edits in ((0, 0), (2, 0), (1, 1)):
            with self.subTest(creates=creates, edits=edits), self.assertRaises(AssertionError):
                self.saved['successfulUiCreateCount'] = self.worker['successfulUiCreateCount'] = creates
                self.saved['successfulUiSaveCount'] = self.worker['successfulUiSaveCount'] = edits
                saved_input.verify_worker(self.saved, self.worker, self.target, operation='create')

    def test_input_contract_does_not_claim_alarm_lifecycle_success(self):
        self.worker['alarmStates'][0]['operation'] = 'CANCEL'
        self.verify()  # Alarm lifecycle is a separate stage-4 gate, not silently reported as UPSERT.

    def test_target_only_edit_preserves_original_selected_plan(self):
        route = {'provider': 'tmap', 'selectedRouteOption': {'id': 'selected'},
                 'steps': [{'mode': 'SUBWAY'}], 'pathCoords': [{'lat': 37.0, 'lng': 127.0}],
                 'transitLegs': [{'mode': 'SUBWAY', 'routeId': 'selected-line'}]}
        before = self.saved['savedScheduleInput'] | {'targetArrivalAt': '2026-10-05T12:19:00Z',
                                                    'selectedRouteJson': json.dumps(route)}
        after = self.saved['savedScheduleInput'] | {'selectedRouteJson': json.dumps(route)}
        saved_input.verify_ui_preserved_plan({'savedScheduleInput': before}, {'savedScheduleInput': after})
        after['selectedRouteJson'] = json.dumps(route | {'steps': []})
        with self.assertRaises(AssertionError):
            saved_input.verify_ui_preserved_plan({'savedScheduleInput': before}, {'savedScheduleInput': after})

    def test_target_only_edit_cannot_clear_origin(self):
        before = self.saved['savedScheduleInput'] | {'targetArrivalAt': '2026-10-05T12:19:00Z'}
        after = self.saved['savedScheduleInput'] | {'originLat': None}
        with self.assertRaises(AssertionError):
            saved_input.verify_ui_preserved_plan({'savedScheduleInput': before}, {'savedScheduleInput': after})

    def test_worker_cannot_replace_target_or_original_route(self):
        for key, wrong in (('targetArrivalAt', '2026-10-05T12:21:00Z'), ('selectedRouteJson', '{}')):
            with self.subTest(key=key), self.assertRaises(AssertionError):
                self.worker['savedScheduleAfterEvaluation'] = self.saved['savedScheduleInput'] | {key: wrong}
                self.verify()

    def test_missing_or_repeated_ui_save_is_rejected(self):
        for count in (0, 2):
            with self.subTest(count=count), self.assertRaises(AssertionError):
                self.saved['successfulUiSaveCount'] = self.worker['successfulUiSaveCount'] = count
                self.verify()

    def test_requery_coordinates_must_match_saved_values(self):
        self.worker['routeRequests'][0]['startY'] = 37.0
        with self.assertRaises(AssertionError):
            self.verify()

    def test_seoul_timezone_conversion_and_future_boundary_are_checked(self):
        self.worker['routeRequests'][0]['searchDttm'] = '202610051101'
        with self.assertRaises(AssertionError):
            self.verify()

    def test_history_must_use_saved_target(self):
        self.worker['evaluationHistory']['targetArrivalAt'] = '2026-10-05T12:19:00Z'
        with self.assertRaises(AssertionError):
            self.verify()

    def test_each_search_has_distinct_minute_and_bounded_budget(self):
        self.worker['routeRequests'] *= 2
        with self.assertRaises(AssertionError):
            self.verify()

    def test_unaccepted_result_is_not_correction_success(self):
        self.worker['effectiveSnapshot']['accepted'] = False
        with self.assertRaises(AssertionError):
            self.verify()


if __name__ == '__main__':
    unittest.main()

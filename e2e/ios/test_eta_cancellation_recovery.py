import copy
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('verify-eta-cancellation-recovery.py'))
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


def state(operation, reason, generation=2):
    return {'id': 1, 'operation': operation, 'cancellation_reason': reason, 'generation': generation}


class CancellationEvidenceTest(unittest.TestCase):
    def test_past_configured_estimate_recovers_with_new_generation(self):
        worker = {'scenario': 'success', 'pastConfiguredRecovery': True,
                  'alarmBeforeEvaluation': [state('CANCEL', 'PAST_CONFIGURED_ESTIMATE')],
                  'alarmStates': [state('UPSERT', None, 3)]}
        recovery.verify_cause(worker)
        worker['alarmStates'][0]['generation'] = 2
        with self.assertRaises(AssertionError):
            recovery.verify_cause(worker)

    def test_user_and_legacy_cancellations_cannot_resume(self):
        for name, reason in [('user-cancel-recovered', 'EXPLICIT_OR_TERMINAL'), ('legacy-cancel-recovered', None)]:
            before = [state('CANCEL', reason)]
            worker = {'scenario': name, 'alarmBeforeEvaluation': before, 'alarmStates': copy.deepcopy(before)}
            recovery.verify_cause(worker)
            worker['alarmStates'] = [state('UPSERT', None, 3)]
            with self.assertRaises(AssertionError):
                recovery.verify_cause(worker)

    def test_unknown_preserves_automatic_cancellation_before_recovery(self):
        before = [state('CANCEL', 'TRANSIT_TRANSFER_FAILURE')]
        previous = {'scenario': 'missed-unknown', 'failureCode': 'TRANSIT_ROUTE_TIMING_ESTIMATE_ONLY',
                    'alarmStates': before}
        worker = {'scenario': 'unknown-recovered', 'alarmBeforeEvaluation': copy.deepcopy(before),
                  'alarmStates': [state('UPSERT', None, 3)]}
        recovery.verify_cause(worker, previous)
        worker['alarmBeforeEvaluation'][0]['cancellation_reason'] = 'EXPLICIT_OR_TERMINAL'
        with self.assertRaises(AssertionError):
            recovery.verify_cause(worker, previous)

    def test_uncertain_result_must_preserve_all_alarm_fields(self):
        before = [state('CANCEL', 'TRANSIT_TRANSFER_FAILURE')]
        worker = {'scenario': 'missed-unknown', 'alarmBeforeEvaluation': before, 'alarmStates': copy.deepcopy(before)}
        recovery.verify_cause(worker, {'alarmStates': before})
        worker['alarmStates'][0]['generation'] += 1
        with self.assertRaises(AssertionError):
            recovery.verify_cause(worker, {'alarmStates': before})


if __name__ == '__main__':
    unittest.main()

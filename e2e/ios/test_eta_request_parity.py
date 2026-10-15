import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('request_parity', Path(__file__).with_name('run-eta-request-parity.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RequestParityTest(unittest.TestCase):
    def trace(self):
        event = dict.fromkeys(module.MATCH_FIELDS, True)
        event.update(order=1, phase='DIRECT', startedAt='2026-10-08T12:00:00Z',
                     finishedAt='2026-10-08T12:00:01Z', durationMillis=1000, httpStatus=200)
        worker = dict(event, order=2, phase='WORKER')
        return {'classification': 'PASSIVE_SAME_PROCESS_SEOUL_ARRIVAL_WIRE_TRACE',
                'transport': 'ORIGINAL_REAL_TRANSPORT_UNCHANGED', 'attempts': [event, worker],
                'omittedAttempts': 0, 'rawCredentialsUrlsOrHashesRetained': False}

    def test_same_wire_requests(self):
        self.assertTrue(module.validate_trace(self.trace()))

    def test_schema_rejects_secret_fields(self):
        for target in ('root', 'event'):
            trace = self.trace()
            (trace if target == 'root' else trace['attempts'][0])['rawUrl'] = 'secret'
            with self.assertRaises(ValueError):
                module.validate_trace(trace)

    def test_mismatch_is_not_pass(self):
        trace = self.trace()
        trace['attempts'][1].update(exactWireRequestMatchesDirect=False, stationMatchesDirect=False)
        self.assertFalse(module.validate_trace(trace))

    def test_direct_must_precede_worker(self):
        trace = self.trace()
        trace['attempts'][0]['phase'] = 'WORKER'
        with self.assertRaises(ValueError):
            module.validate_trace(trace)

    def test_strict_types_and_scope(self):
        base = self.trace()
        for name, value in [('httpStatus', True), ('durationMillis', -1), ('order', True),
                            ('credentialMatchesDirect', 'true'), ('startedAt', '2026-10-08T12:00:00')]:
            trace = copy.deepcopy(base)
            trace['attempts'][0][name] = value
            with self.assertRaises(ValueError, msg=name):
                module.validate_trace(trace)

    def test_omitted_attempts_are_incomplete(self):
        trace = self.trace()
        trace['omittedAttempts'] = 1
        self.assertFalse(module.validate_trace(trace))

    def test_failed_or_empty_direct_never_allows_worker(self):
        self.assertFalse(module.direct_gate({'failureKind': 'ProviderError', 'vehicles': [1]}))
        self.assertFalse(module.direct_gate({'failureKind': None, 'vehicles': []}))
        self.assertTrue(module.direct_gate({'failureKind': None, 'vehicles': [1]}))

    def test_worker_delta_does_not_claim_direct_success(self):
        success = dict(provider='seoul_subway', operation='arrival', outcome='success', count=1)
        failure = dict(success, outcome='application_error')
        self.assertEqual([failure], module.wire_delta([success], [success, failure]))
        with self.assertRaises(ValueError):
            module.wire_delta([success], [dict(success, count=0)])


if __name__ == '__main__':
    unittest.main()

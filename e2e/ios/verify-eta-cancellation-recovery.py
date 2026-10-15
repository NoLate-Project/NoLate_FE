#!/usr/bin/env python3
"""Check real simulator UI with private synthetic feeds; not audible delivery proof."""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess

SPEC = importlib.util.spec_from_file_location('fixture_contract', Path(__file__).with_name('verify-eta-fixture.py'))
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
SCENARIOS = ('success', 'reconnect', 'unknown', 'missed', 'missed-unknown',
             'unknown-recovered', 'user-cancel-recovered', 'legacy-cancel-recovered', 'late')
PHASE = {'missed-unknown': 'unknown', 'unknown-recovered': 'recovered',
         'user-cancel-recovered': 'recovered', 'legacy-cancel-recovered': 'recovered'}


def verify_cause(worker, previous=None):
    name = worker['scenario']
    before, after = worker['alarmBeforeEvaluation'], worker['alarmStates']
    assert len(before) == len(after) == 1, name
    old, new = before[0], after[0]
    assert old['id'] == new['id'], name
    if name == 'success':
        assert worker['pastConfiguredRecovery'] is True
        assert old['operation'] == 'CANCEL' and old['cancellation_reason'] == 'PAST_CONFIGURED_ESTIMATE'
        assert new['operation'] == 'UPSERT' and new['cancellation_reason'] is None
        assert new['generation'] > old['generation']
    elif name == 'missed':
        assert old['operation'] == 'UPSERT'
        assert new['operation'] == 'CANCEL' and new['cancellation_reason'] == 'TRANSIT_TRANSFER_FAILURE'
        assert new['generation'] > old['generation']
    elif name in ('unknown', 'missed-unknown', 'late'):
        assert after == before, f'{name}: rejected ETA changed alarm'
        if name == 'missed-unknown':
            assert old['operation'] == 'CANCEL' and old['cancellation_reason'] == 'TRANSIT_TRANSFER_FAILURE'
        if previous is not None:
            assert before == previous['alarmStates'], f'{name}: cancellation lineage changed before evaluation'
    elif name == 'unknown-recovered':
        assert previous['scenario'] == 'missed-unknown'
        assert previous['failureCode'] == 'TRANSIT_ROUTE_TIMING_ESTIMATE_ONLY'
        assert before == previous['alarmStates']
        assert old['operation'] == 'CANCEL' and old['cancellation_reason'] == 'TRANSIT_TRANSFER_FAILURE'
        assert new['operation'] == 'UPSERT' and new['cancellation_reason'] is None
        assert new['generation'] > old['generation']
    elif name in ('user-cancel-recovered', 'legacy-cancel-recovered'):
        reason = 'EXPLICIT_OR_TERMINAL' if name == 'user-cancel-recovered' else None
        assert old['operation'] == 'CANCEL' and old['cancellation_reason'] == reason
        assert after == before, f'{name}: accepted ETA resurrected a protected cancellation'
    elif name == 'reconnect':
        assert new['operation'] == 'UPSERT' and new['cancellation_reason'] is None
    else:
        raise AssertionError('Unknown scenario')


def verify(root):
    root = root.resolve(strict=True)
    if not str(root).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        raise ValueError('Evidence must be private H2 output')
    results = {}
    previous = None
    for index, name in enumerate(SCENARIOS, 1):
        worker = json.loads((root / f'{name}.json').read_text())
        public = json.loads((root / f'{name}-status.json').read_text())
        phase = PHASE.get(name, name)
        metadata = json.loads((root / f'ui-{name}/metadata.json').read_text())
        ui = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
                                                'summary', '--path', str(root / f'ui-{name}/result.xcresult')]))
        assert ui['result'] == 'Passed' and ui['passedTests'] == ui['totalTestCount'] == 1, name
        assert ui['failedTests'] == ui['skippedTests'] == 0, name
        assert all(d['device']['deviceId'] == fixture.DEVICE for d in ui['devicesAndConfigurations']), name
        assert metadata['apiBase'] == 'http://127.0.0.1:5523' and metadata['fixturePhase'] == phase, name
        assert metadata['method'] == 'testVerifyIsolatedEtaFixture' and metadata['allowSave'] is False, name
        assert worker['scenario'] == name and worker['phase'] == phase, name
        assert worker['processed'] == 1 and worker['historyCount'] == index, name
        assert worker['retryCount'] == 0 and worker['workerFailure'] is None, name
        assert worker['clockMode'] == 'FIXED_PRIVATE_BACKEND_SNAPSHOT_CLOCK', name
        assert worker['savedScheduleInput'] == worker['savedScheduleAfterEvaluation'], name
        history = worker['evaluationHistory']
        assert history['memberId'] == 296 and history['scheduleId'] == 363, name
        assert fixture.instant(history['targetArrivalAt']) == fixture.instant(worker['targetArrivalAt']), name
        assert abs(fixture.instant(history['evaluatedAt']) - fixture.instant(worker['evaluatedAt'])) <= dt.timedelta(microseconds=1), name
        accepted = phase in ('success', 'reconnect', 'recovered')
        assert worker['effectiveSnapshot']['accepted'] == accepted, name
        assert public['scheduleId'] == 363 and public['stale'] is (not accepted), name
        assert fixture.instant(public['recommendedDepartureAt']) == fixture.instant(worker['recommendedDepartureAt']), name
        if accepted:
            seconds = 2452 if phase == 'success' else 2752
            epoch = fixture.instant(worker['epoch'])
            assert fixture.instant(worker['recommendedDepartureAt']) == epoch, name
            assert fixture.instant(public['predictedArrivalAt']) == epoch + dt.timedelta(seconds=seconds), name
            assert public['travelMinutes'] == (41 if phase == 'success' else 46), name
            assert public['confidence'] == 'HIGH' and public['failureReason'] is None, name
            assert public['transitTimingBasis'] == 'FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE', name
            fixture.verify_current_journey(public, worker['effectiveSnapshot'], phase)
            # The same accepted journey must preserve all walking boundaries and
            # include egress once; recovery must not silently drop or duplicate it.
            fixture.verify_walking_metadata(public, worker['effectiveSnapshot'])
            fixture.verify_egress_included_once(public, epoch, phase)
            assert '현재 보정 여정' in (root / f'ui-{name}/run.log').read_text(), name
        else:
            code = {'unknown': 'TRANSIT_ROUTE_TIMING_ESTIMATE_ONLY', 'missed': 'TRANSIT_TRANSFER_MISSED',
                    'late': 'TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE'}[phase]
            assert worker['failureCode'] == code and public['failureReason'].startswith(code + ':'), name
            assert public['confidence'] == 'LOW', name
        verify_cause(worker, previous)
        results[name] = {'result': 'PASSED', 'historyCount': index,
                         'alarmOperation': worker['alarmStates'][0]['operation'],
                         'cancellationReason': worker['alarmStates'][0]['cancellation_reason'],
                         'generation': worker['alarmStates'][0]['generation'],
                         'uiResultBundle': str(root / f'ui-{name}/result.xcresult')}
        previous = worker
    return {'classification': 'ISOLATED_MOCK_FEED_SIMULATOR_E2E', 'result': 'PASSED',
            'device': fixture.DEVICE, 'database': 'H2_MEMORY_ONLY', 'productionDatabaseModified': False,
            'automaticCancellationRecoveryVerified': True, 'protectedCancellationsPreserved': True,
            'realWorldAccuracyVerified': False, 'nativeAlarmDeliveryVerified': False, 'scenarios': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.root), ensure_ascii=False, indent=2))

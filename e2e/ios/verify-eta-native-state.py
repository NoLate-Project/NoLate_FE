#!/usr/bin/env python3
"""Independently verify private Worker -> real OS pending requests. Not delivery/accuracy proof."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import uuid

DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
NATIVE_ID = 'schedule:363:member:296:occurrence:M0'


def instant(value):
    result = dt.datetime.fromisoformat(value)
    assert result.tzinfo is not None
    return result


def request_id(native_id=NATIVE_ID):
    raw = bytearray(hashlib.sha256(('nolate.departure|' + native_id).encode()).digest()[:16])
    raw[6] = (raw[6] & 15) | 80
    raw[8] = (raw[8] & 63) | 128
    return 'nolate.departure.' + str(uuid.UUID(bytes=bytes(raw)))


def verify_record(worker, record):
    assert worker['processed'] == 1 and worker['retryCount'] == 0 and worker['workerFailure'] is None
    assert worker['savedScheduleInput']['memberId'] == 296 and worker['savedScheduleInput']['scheduleId'] == 363
    assert worker['savedScheduleInput'] == worker['savedScheduleAfterEvaluation']
    assert record['classification'] == 'REAL_NATIVE_SIMULATOR_H2_SNAPSHOT'
    if worker.get('automaticScheduling') is True and worker.get('providersMocked') is False:
        assert record['sync'].get('inspectionOnly') is True and record['sync']['fetched'] is False
    else:
        assert record['sync']['fetched'] is True
    assert record['sync']['failedCount'] == 0
    assert record['capabilities']['notificationAuthorized'] is True
    state, = worker['alarmStates']
    assert state['member_id'] == 296 and state['schedule_id'] == 363
    alarms, pending = record['alarms'], record['osPending']
    if state['operation'] == 'CANCEL':
        assert state['trigger_at'] is None and alarms == pending == []
        return
    plan = json.loads(state['alarm_occurrences_json'])
    future = [item for item in plan if instant(item['triggerAt']) > instant(record['observedAt'])]
    assert state['operation'] == 'UPSERT' and future and len(alarms) == len(pending) == len(future)
    assert len({item['occurrenceId'] for item in plan}) == len(plan)
    for item in future:
        native_id = 'schedule:363:member:296:occurrence:' + item['occurrenceId']
        alarm, = [a for a in alarms if a['nativeAlarmId'] == native_id]
        request, = [r for r in pending if r['nativeAlarmId'] == native_id]
        assert alarm['generation'] == request['generation'] == state['generation']
        assert alarm['occurrenceId'] == request['occurrenceId'] == item['occurrenceId']
        assert request['identifier'] == request_id(native_id)
        trigger = request['trigger']
        assert trigger['type'] == 'calendar' and trigger['repeats'] is False
        fields = trigger['dateComponents']
        assert fields['timeZone'].startswith('GMT')
        actual = dt.datetime(*(fields[k] for k in ('year', 'month', 'day', 'hour', 'minute', 'second')), tzinfo=dt.timezone.utc)
        assert actual == instant(alarm['triggerAt']) == instant(item['triggerAt'])


def verify(root):
    root = root.resolve(strict=True)
    assert str(root).startswith('/private/tmp/nolate-eta-mock-e2e.')
    cases = ('baseline', 'earlier', 'unknown', 'later-updated', 'cancel')
    previous = None
    results = {}
    for name in cases:
        worker = json.loads((root / ('native-' + name + '.json')).read_text())
        run = root / ('ui-native-' + name)
        meta = json.loads((run / 'metadata.json').read_text())
        assert meta['device'] == DEVICE and meta['memberScope'] == 296 and meta['apiBase'] == 'http://127.0.0.1:5523'
        assert meta['method'] == 'testVerifyIsolatedNativeAlarmState' and meta['nativeMode'] == 'state' and meta['allowSave'] is False
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(run / 'result.xcresult')]))
        assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
        assert summary['failedTests'] == summary['skippedTests'] == 0
        assert all(item['device']['deviceId'] == DEVICE for item in summary['devicesAndConfigurations'])
        log = (run / 'run.log').read_text()
        records = [json.loads(line.split(': ', 1)[1]) for line in log.splitlines() if line.startswith('ETA_NATIVE_STATE_EVIDENCE: ')]
        assert len(records) == 2 and 'ETA_NATIVE_DUPLICATE_REPLAY_VERIFIED' in log
        for record in records:
            verify_record(worker, record)
        assert records[0]['osPending'] == records[1]['osPending']
        state, = worker['alarmStates']
        if previous is not None:
            old, = previous['alarmStates']
            assert worker['alarmBeforeEvaluation'] == previous['alarmStates']
            if name == 'earlier':
                assert state['generation'] > old['generation']
                assert instant(state['trigger_at']) < instant(old['trigger_at'])
            elif name == 'unknown':
                assert worker['alarmStates'] == previous['alarmStates']
                assert worker['stale'] is True and worker['failureCode'] == 'TRANSIT_ROUTE_TIMING_ESTIMATE_ONLY'
            elif name == 'later-updated':
                # This synthetic phase changes the target and resets only the private
                # job's prior departure. It proves OS replacement, NOT permission to
                # postpone an unchanged production target after an uncertain ETA.
                assert worker['stale'] is False and state['generation'] > old['generation']
                assert instant(state['trigger_at']) > instant(old['trigger_at'])
                assert instant(worker['recommendedDepartureAt']) == instant(state['trigger_at'])
            elif name == 'cancel':
                assert old['operation'] == 'UPSERT' and state['operation'] == 'CANCEL'
                assert state['generation'] > old['generation'] and state['cancellation_reason'] == 'TRANSIT_TRANSFER_FAILURE'
                assert instant(old['trigger_at']) > instant(records[0]['observedAt']), 'Cancellation must precede the old due time'
        results[name] = {'result': 'PASSED', 'generation': state['generation'], 'operation': state['operation'],
                         'actualOsPendingCount': len(records[0]['osPending']), 'uiResultBundle': str(run / 'result.xcresult')}
        previous = worker
    return {'classification': 'REAL_OS_PENDING_PRIVATE_MOCK_ETA_SIMULATOR_E2E', 'result': 'PASSED',
            'device': DEVICE, 'database': 'H2_MEMORY_ONLY', 'productionDatabaseModified': False,
            'syntheticTargetChangesAndPrivateJobReset': True,
            'realWorldAccuracyVerified': False, 'nativeAlarmExecutionVerifiedByThisCheck': False, 'scenarios': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    print(json.dumps(verify(parser.parse_args().root), ensure_ascii=False, indent=2))

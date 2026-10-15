#!/usr/bin/env python3
"""Verify actual UI target save -> private Worker -> installed app evidence."""
import argparse
import datetime as dt
import json
import re
from pathlib import Path
import subprocess

DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
SEOUL = dt.timezone(dt.timedelta(hours=9))


def instant(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timezone is required')
    return parsed


def verify_worker(saved, worker, requested_target, operation='edit'):
    expected = saved['savedScheduleInput']
    if operation == 'create':
        assert saved['successfulUiCreateCount'] == worker['successfulUiCreateCount'] == 1
        assert saved['successfulUiSaveCount'] == worker['successfulUiSaveCount'] == 0
    else:
        assert operation == 'edit'
        assert saved['successfulUiSaveCount'] == worker['successfulUiSaveCount'] == 1
    assert expected == worker['savedScheduleInput'] == worker['savedScheduleAfterEvaluation']
    assert instant(expected['targetArrivalAt']) == instant(requested_target) == instant(worker['targetArrivalAt'])
    assert expected['scheduleId'] == 363 and expected['memberId'] == 296
    assert expected['travelMode'] == 'TRANSIT'
    assert json.loads(expected['selectedRouteJson'])['provider'] == 'tmap'
    requests = worker['routeRequests']
    assert 1 <= len(requests) <= 3
    assert len({item['searchDttm'] for item in requests}) == len(requests)
    evaluation = instant(worker['evaluationHistory']['evaluatedAt'])
    assert instant(worker['evaluatedAt']) <= evaluation
    assert worker['evaluationHistory']['scheduleId'] == 363
    assert worker['evaluationHistory']['memberId'] == 296
    assert instant(worker['evaluationHistory']['targetArrivalAt']) == instant(requested_target)
    for request in requests:
        assert request['startX'] == expected['originLng'] == 127.0610
        assert request['startY'] == expected['originLat'] == 37.6551
        assert request['endX'] == expected['destinationLng'] == 126.9297
        assert request['endY'] == expected['destinationLat'] == 37.4842
        search_at = dt.datetime.strptime(request['searchDttm'], '%Y%m%d%H%M').replace(tzinfo=SEOUL)
        assert search_at >= evaluation, 'Do not query a backdated departure'
    epoch = instant(worker['epoch'])
    assert worker['processed'] == 1 and worker['phase'] == 'success'
    assert worker['effectiveSnapshot']['accepted'] is True
    assert worker['source'] == 'LIVE_PROVIDER' and worker['failureCode'] is None and worker['stale'] is False
    assert instant(worker['recommendedDepartureAt']) == epoch
    assert instant(worker['predictedArrivalAt']) == epoch + dt.timedelta(seconds=2452)
    assert instant(worker['predictedArrivalAt']) <= instant(requested_target)
    # Stage 1 proves input preservation and displayed ETA, not the later alarm lifecycle gate.
    # Preserve the observed alarm operation in the report; never turn a CANCEL into an alarm pass.


def verify_ui_preserved_plan(initial, saved):
    before = initial['savedScheduleInput']
    after = saved['savedScheduleInput']
    assert instant(before['targetArrivalAt']) != instant(after['targetArrivalAt']), 'UI must actually change the target'
    for key in ('scheduleId', 'memberId', 'originLat', 'originLng', 'destinationLat', 'destinationLng', 'travelMode'):
        assert before[key] == after[key], f'Target-only edit changed {key}'
    original_route = json.loads(before['selectedRouteJson'])
    saved_route = json.loads(after['selectedRouteJson'])
    for key in ('provider', 'selectedRouteOption', 'steps', 'pathCoords', 'transitLegs'):
        assert original_route[key] == saved_route[key], f'Target-only edit changed selected plan {key}'


def verify(root, save_run='ui-save-target'):
    root = root.resolve(strict=True)
    if not str(root).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        raise ValueError('Private fixture evidence is required')
    saved = json.loads((root / 'ui-saved-input.json').read_text())
    initial = json.loads((root / 'success.json').read_text())
    verify_ui_preserved_plan(initial, saved)
    worker = json.loads((root / 'saved-success.json').read_text())
    if re.fullmatch(r'ui-save-target(?:-retry[1-9]?[0-9]?)?', save_run) is None:
        raise ValueError('Only named private save attempts are allowed')
    save_metadata = json.loads((root / save_run / 'metadata.json').read_text())
    verify_worker(saved, worker, save_metadata['targetArrival'])
    for name, method in ((save_run, 'testSaveIsolatedEtaTarget'),
                         ('ui-saved-success', 'testVerifyIsolatedEtaFixture')):
        metadata = json.loads((root / name / 'metadata.json').read_text())
        assert metadata['method'] == method and metadata['apiBase'] == 'http://127.0.0.1:5523'
        assert metadata['device'] == DEVICE and metadata['memberScope'] == 296
        summary = json.loads(subprocess.check_output([
            'xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(root / name / 'result.xcresult'),
        ]))
        assert summary['result'] == 'Passed' and summary['passedTests'] == 1 and summary['failedTests'] == 0
        assert summary['skippedTests'] == 0 and summary['totalTestCount'] == 1
        assert all(item['device']['deviceId'] == DEVICE for item in summary['devicesAndConfigurations'])
    public = json.loads((root / 'success-status.json').read_text())
    assert public['scheduleId'] == 363 and public['source'] == 'LIVE_PROVIDER' and public['confidence'] == 'HIGH'
    assert public['travelMinutes'] == 41 and public['stale'] is False
    assert instant(public['recommendedDepartureAt']) == instant(worker['epoch'])
    assert instant(public['predictedArrivalAt']) == instant(worker['epoch']) + dt.timedelta(seconds=2452)
    return {
        'stage': 1, 'classification': 'ISOLATED_MOCK_FEED_SAVED_TARGET_SIMULATOR_E2E', 'result': 'PASSED',
        'passedScope': 'EXISTING_SCHEDULE_EDIT_AND_REQUERY', 'wholeStageGateResult': 'PARTIAL',
        'device': DEVICE, 'database': 'H2_MEMORY_ONLY', 'productionDatabaseModified': False,
        'actualUiTargetSaveCount': 1, 'newScheduleCreationUiVerified': False,
        'saveUiResultBundle': str(root / save_run / 'result.xcresult'),
        'updatedEtaUiResultBundle': str(root / 'ui-saved-success/result.xcresult'),
        'targetArrivalAt': saved['savedScheduleInput']['targetArrivalAt'],
        'savedInputPreserved': True, 'providerSearchCount': len(worker['routeRequests']),
        'historyTargetMatchesSavedTarget': True, 'appShowsUpdatedEta': True,
        'observedAutomaticAlarmOperation': worker['alarmStates'][0]['operation'],
        'automaticAlarmLifecycleVerified': False,
        'realProviderCorrectionVerified': False, 'realWorldAccuracyVerified': False,
        'nativeAlarmDeliveryVerified': False,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--save-run', default='ui-save-target', help='Named private UI save attempt')
    args = parser.parse_args()
    print(json.dumps(verify(args.root, args.save_run), indent=2, ensure_ascii=False))

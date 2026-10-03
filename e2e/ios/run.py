#!/usr/bin/env python3
"""Run native UI tests on an explicit dedicated simulator (no app/server rebuild)."""
import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True, help='Dedicated booted simulator UDID')
parser.add_argument('--credentials', type=Path)
parser.add_argument('--output', type=Path, required=True, help='New output directory, outside the repository')
parser.add_argument('--only', default='testLoginInputAndValidation')
args = parser.parse_args()
args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
env = os.environ.copy()
if args.credentials:
    fixture = json.loads(args.credentials.read_text())
    env['TEST_RUNNER_E2E_EMAIL'] = fixture['email']
    env['TEST_RUNNER_E2E_PASSWORD'] = fixture['password']
command = ['xcodebuild', '-project', str(Path(__file__).resolve().parent / 'NoLateE2E.xcodeproj'),
           '-scheme', 'NoLateE2E', '-destination', 'platform=iOS Simulator,id=' + args.device,
           '-parallel-testing-enabled', 'NO', '-derivedDataPath', '/private/tmp/nolate-xcuitest',
           '-resultBundlePath', str(args.output / 'result.xcresult'),
           '-only-testing:NoLateE2ETests/NoLateE2ETests/' + args.only, 'test']
with (args.output / 'run.log').open('w') as log:
    result = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT)
print('xcodebuild exit:', result.returncode, '; results:', args.output)
raise SystemExit(result.returncode)

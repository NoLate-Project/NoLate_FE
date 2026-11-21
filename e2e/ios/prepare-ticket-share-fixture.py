#!/usr/bin/env python3
"""Install a synthetic share host and a rebuilt extension on an explicit E2E simulator."""
import argparse
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import time
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True)
parser.add_argument('--extension', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--smart-ticket-photo', nargs='?', const='example', choices=['example', 'upcoming'],
                    help='Seed the example JPEG or a ticket for tomorrow into this simulator’s Photos library.')
args = parser.parse_args()

def run(*command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)

devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', '-j']))
device = next(item for group in devices['devices'].values() for item in group if item['udid'] == args.device)
if 'E2E' not in device['name'] or device['state'] != 'Booted':
    raise SystemExit('Use a booted, dedicated simulator whose name includes E2E.')
if not str(args.output.resolve()).startswith('/private/tmp/nolate-ticket-'):
    raise SystemExit('Use a new private /private/tmp/nolate-ticket-* output directory.')
if args.extension.suffix != '.appex' or not (args.extension / 'NoLateShareExtension').is_file():
    raise SystemExit('Pass the Xcode-built NoLateShareExtension.appex.')
sections = subprocess.check_output(['xcrun', 'otool', '-l', str(args.extension / 'NoLateShareExtension')], text=True)
if 'sectname __entitlements' not in sections:
    raise SystemExit('Build with CODE_SIGNING_ALLOWED=YES so Xcode embeds simulator Keychain entitlements.')
args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
source = Path(subprocess.check_output(['xcrun', 'simctl', 'get_app_container', args.device, 'com.anonymous.nolatefe', 'app'], text=True).strip())
app = args.output / 'NoLateTicketTest.app'
run('ditto', str(source), str(app))
extension = app / 'PlugIns/NoLateShareExtension.appex'
source_plist = plistlib.loads((Path(__file__).resolve().parents[2] / 'ios/NoLateFE/Info.plist').read_bytes())
plist_path = app / 'Info.plist'
plist = plistlib.loads(plist_path.read_bytes())
plist['LSApplicationQueriesSchemes'] = source_plist['LSApplicationQueriesSchemes']
plist_path.write_bytes(plistlib.dumps(plist))
shutil.rmtree(extension)
run('ditto', str(args.extension), str(extension))
# Simulator entitlements come from __TEXT, not device entitlements added to this signature.
run('codesign', '--force', '--sign', '-', '--generate-entitlement-der', str(app))
subprocess.run(['xcrun', 'simctl', 'terminate', args.device, 'com.anonymous.nolatefe'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
run('xcrun', 'simctl', 'install', args.device, str(app))

host = args.output / 'TicketShareFixture.app'
host.mkdir()
if (args.extension / 'TicketWebPage.js').is_file():
    shutil.copy2(args.extension / 'TicketWebPage.js', host / 'TicketWebPage.js')
shutil.copy2(Path(__file__).with_name('fixtures') / 'smart-ticket-print.html', host / 'smart-ticket-print.html')
(host / 'Info.plist').write_bytes(plistlib.dumps({
    'CFBundleIdentifier': 'dev.nolate.ticketfixture', 'CFBundleName': 'TicketShareFixture',
    'CFBundleExecutable': 'TicketShareFixture', 'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0', 'UILaunchScreen': {},
    'LSRequiresIPhoneOS': True, 'MinimumOSVersion': '16.6', 'UIDeviceFamily': [1],
    'UIApplicationSceneManifest': {'UIApplicationSupportsMultipleScenes': False},
}))
sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], text=True).strip()
run('xcrun', 'swiftc', '-sdk', sdk, '-target', 'arm64-apple-ios16.6-simulator', '-parse-as-library',
    str(Path(__file__).with_name('TicketShareFixture.swift')), '-o', str(host / 'TicketShareFixture'), env={**os.environ, 'SDKROOT': sdk})
run('codesign', '--force', '--sign', '-', str(host))
subprocess.run(['xcrun', 'simctl', 'terminate', args.device, 'dev.nolate.ticketfixture'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
run('xcrun', 'simctl', 'install', args.device, str(host))
if args.smart_ticket_photo:
    bundle_id = 'dev.nolate.ticketfixture'
    container = Path(subprocess.check_output(
        ['xcrun', 'simctl', 'get_app_container', args.device, bundle_id, 'data'], text=True).strip())
    photo = container / 'Documents/NoLateSmartTicketFixture.jpg'
    previous = photo.stat().st_mtime_ns if photo.exists() else None
    launch_env = os.environ.copy()
    if args.smart_ticket_photo == 'upcoming':
        travel_day = datetime.now(ZoneInfo('Asia/Seoul')).date() + timedelta(days=1)
        weekday = '월화수목금토일'[travel_day.weekday()]
        launch_env['SIMCTL_CHILD_E2E_SMART_TICKET_DATE'] = f'{travel_day:%Y년%m월%d일}({weekday})'
    run('xcrun', 'simctl', 'launch', '--terminate-running-process', args.device, bundle_id,
        '--export-smart-ticket-photo', env=launch_env)
    deadline = time.monotonic() + 30
    while not photo.is_file() or photo.stat().st_mtime_ns == previous:
        if time.monotonic() >= deadline:
            raise SystemExit('The fixture did not export a new JPEG.')
        time.sleep(0.25)
    exported = args.output / ('NoLateUpcomingSmartTicketFixture.jpg' if args.smart_ticket_photo == 'upcoming' else photo.name)
    shutil.copy2(photo, exported)
    run('xcrun', 'simctl', 'addmedia', args.device, str(exported))
    print(f'Added {exported.name} to the dedicated Photos library.')
print('Synthetic share host and rebuilt NoLate extension installed on the dedicated simulator.')

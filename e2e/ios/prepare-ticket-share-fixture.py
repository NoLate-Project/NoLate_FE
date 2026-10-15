#!/usr/bin/env python3
"""Install a synthetic share host and a rebuilt extension on an explicit E2E simulator."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True)
parser.add_argument('--extension', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
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
print('Synthetic share host and rebuilt NoLate extension installed on the dedicated simulator.')

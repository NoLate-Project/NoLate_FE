#!/usr/bin/env python3
"""Create a synthetic member on the existing local server; never starts a server."""
import datetime
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.request

base = 'http://127.0.0.1:5522'

def request(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)['data']

output = Path(sys.argv[1])
if output.exists():
    raise SystemExit('Refusing to overwrite existing fixture credentials')
consents = request('/api/legal/signup-consents')
email = 'xcuitest-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '@example.test'
password = 'Qa!9' + secrets.token_hex(5)
member = request('/api/member/auth/sign-up', {
    'email': email, 'password': password, 'name': 'XCUITest 검증',
    'consents': {'termsVersion': consents['terms']['version'],
                 'privacyCollectionVersion': consents['privacyCollection']['version'],
                 'termsAgreed': True, 'privacyCollectionAgreed': True},
})
with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as file:
    json.dump({'email': email, 'password': password, 'memberId': member['id']}, file)
print('Created synthetic member', member['id'], '; credentials saved privately')

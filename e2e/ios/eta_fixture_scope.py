"""Fail closed before sending test credentials or mutations to a private fixture."""
import http.client
import json

PRIVATE_API_BASE = 'http://127.0.0.1:5523'
INCIDENT_API_BASE = 'http://127.0.0.1:5525'
REAL_ALTERNATE_API_BASE = 'http://127.0.0.1:5527'
DATED_TIMETABLE_PORTS = (5529, 5533)
DATED_TIMETABLE_API_BASES = tuple(f'http://127.0.0.1:{port}' for port in DATED_TIMETABLE_PORTS)
QUOTA_ALTERNATE_API_BASE = 'http://127.0.0.1:5528'


def require_memory_fixture_api(base):
    if base not in (PRIVATE_API_BASE, INCIDENT_API_BASE, QUOTA_ALTERNATE_API_BASE):
        raise ValueError('Only a dedicated fixture is allowed; no HTTP request sent')
    # A direct connection never follows a redirect or an environment HTTP proxy.
    connection = http.client.HTTPConnection('127.0.0.1', int(base.rsplit(':', 1)[1]), timeout=3)
    try:
        connection.request('GET', '/health/readiness')
        response = connection.getresponse()
        if response.status != 200 or response.getheader('X-NoLate-Eta-Fixture') != 'h2-memory-only':
            raise RuntimeError('Dedicated H2 fixture marker required; no credentials or mutations sent')
        payload = response.read(4097)
        if len(payload) > 4096:
            raise RuntimeError('Unexpected fixture readiness response size')
        try:
            ready = json.loads(payload)
        except (ValueError, UnicodeError):
            raise RuntimeError('Invalid fixture readiness response') from None
        if not isinstance(ready, dict) or ready.get('status') != 'UP':
            raise RuntimeError('Dedicated fixture is not ready')
        return {'status': 'UP', 'fixture': 'h2-memory-only'}
    except (OSError, http.client.HTTPException):
        raise RuntimeError('Dedicated fixture readiness unavailable; no credentials or mutations sent') from None
    finally:
        connection.close()

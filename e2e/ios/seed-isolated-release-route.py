#!/usr/bin/env python3
"""Seed one clearly synthetic saved transit route in the dedicated loopback H2 server."""
import datetime as dt
import json
from pathlib import Path
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:5522"
credentials = json.loads(Path(sys.argv[1]).read_text())
if not credentials["email"].endswith("@example.test"):
    raise SystemExit("Only synthetic members are allowed")

def call(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)["data"]
    except urllib.error.HTTPError as error:
        response = json.load(error)
        safe_error = response.get("error") or {}
        scalar = {key: value for key, value in response.items() if isinstance(value, (str, int, bool, type(None)))}
        raise SystemExit(f"Isolated API rejected {path}: HTTP {error.code}, error={safe_error}, scalar={scalar}") from None

member = call("/api/member/auth/login", {
    "email": credentials["email"], "password": credentials["password"]
})
if member["id"] != credentials["memberId"]:
    raise SystemExit("Unexpected synthetic member")
categories = call("/api/schedule-categories", token=member["accessToken"])
category = next((row for row in categories if row.get("title") == "격리 검증"), None)
if category is None:
    category = call("/api/schedule-categories", {"title": "격리 검증", "color": "#246BFE"}, member["accessToken"])

def point(longitude):
    return {"lat": 37.5665, "lng": longitude}

def leg(kind, longitudes, minutes):
    bus = kind == "BUS"
    return {
        "kind": kind, "label": "합성 버스" if bus else "합성 도보", "durationMinutes": minutes,
        "startName": "합성 승차" if bus else "합성 도보",
        "endName": "합성 하차" if bus else "합성 도보 끝",
        "lineName": "합성 버스" if bus else None, "stationCount": 3 if bus else None,
        "lineColor": "#E8752B" if bus else None,
        "startCoord": point(longitudes[0]), "endCoord": point(longitudes[-1]),
        "pathCoords": [point(value) for value in longitudes], "pathCoordsIsExact": True,
        "pathGeometrySource": "TRANSIT_PASS_SHAPE_LINESTRING" if bus else "WALK_STEPS_LINESTRING",
        "serviceAvailable": True if bus else None,
        "navigationEvidence": {
            "version": 1, "provider": "tmap", "geometryInputComplete": True,
            "declaredStationCount": 3 if bus else None,
            "directionName": "합성 동쪽 방면" if bus else None,
            "directionCode": "DOWN" if bus else None,
            "stopOccurrences": [
                {"sourceIndex": index, "providerSequence": index,
                 "name": f"합성 정류장 {index + 1}", "code": f"synthetic-{index}",
                 "coord": point(value)}
                for index, value in enumerate(longitudes)
            ] if bus else [],
        },
    }

route = {
    "id": "isolated-release-synthetic-route", "label": "격리 시험 경로",
    "summary": "합성 버스 · 실제 정류장 아님", "durationMinutes": 9,
    "distanceMeters": 1145, "mode": "TRANSIT", "provider": "tmap",
    "source": "api", "routeReliability": "live_provider",
    "routePlausibility": "normal", "transitServiceState": "operating",
    "transitLegs": [
        leg("WALK", [126.978, 126.97875, 126.9795], 2),
        leg("BUS", [126.9795, 126.9845, 126.9895], 5),
        leg("WALK", [126.9895, 126.99025, 126.991], 2),
    ],
}
start = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)
departure = start - dt.timedelta(minutes=9)
schedule = call("/api/schedules", {
    "title": "격리 Release 합성 경로", "startAt": start.isoformat(),
    "category": {"id": str(category["id"]), "title": "격리 검증", "color": "#246BFE"},
    "travelMinutes": 9, "departAt": departure.isoformat(), "travelMode": "TRANSIT",
    "origin": {"name": "합성 출발", "lat": 37.5665, "lng": 126.978},
    "destination": {"name": "합성 도착", "lat": 37.5665, "lng": 126.991},
    "route": route, "notificationEnabled": False,
}, member["accessToken"])
if not schedule.get("id") or schedule.get("title") != "격리 Release 합성 경로":
    raise SystemExit("Synthetic route save did not confirm")
print("Isolated synthetic saved schedule:", schedule["id"])

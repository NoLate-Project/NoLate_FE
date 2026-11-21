#!/usr/bin/env python3
"""Drive a saved TMAP car schedule through the installed Release app with simulator Core Location."""

import argparse
import bisect
import datetime
import json
import hashlib
import math
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import urllib.request

API = "http://127.0.0.1:5535"
DEVICE = "180F9626-79FD-40FA-BE80-F8D13EE4EB8D"
TEST = "NoLateE2ETests/NoLateE2ETests/testSavedDrivingRouteFollowsLocationThroughTurns"
VOICE_TEST = "NoLateE2ETests/NoLateE2ETests/testSavedDrivingVoiceSurvivesRelaunchAndRespectsMute"
REROUTE_TEST = "NoLateE2ETests/NoLateE2ETests/testSavedDrivingRouteAutomaticallyFollowsReplacementRoad"
LOSS_TEST = "NoLateE2ETests/NoLateE2ETests/testLockedDrivingRouteWithdrawsGuidanceWhenLocationIsRevoked"


def read(path):
    return json.loads(path.read_text())


def meters(a, b):
    phi = math.radians((a[0] + b[0]) / 2)
    return 6371000 * math.hypot(math.radians(a[0] - b[0]), math.radians(a[1] - b[1]) * math.cos(phi))


class Trip:
    def __init__(self, route):
        self.vertices, self.lengths, self.turns = [], [], []
        for step in route["guideSteps"]:
            if step.get("turnType") not in (None, "200", "201"):
                self.turns.append((self.lengths[-1], step["instruction"]))
            for p in step.get("pathCoords", []):
                vertex = (p["lat"], p["lng"])
                delta = meters(self.vertices[-1], vertex) if self.vertices else 0
                if self.vertices and delta < 0.1:
                    continue
                self.lengths.append((self.lengths[-1] if self.lengths else 0) + delta)
                self.vertices.append(vertex)

    def at(self, along):
        i = max(1, min(len(self.lengths) - 1, bisect.bisect_left(self.lengths, along)))
        fraction = min(1, max(0, (along - self.lengths[i-1]) / (self.lengths[i] - self.lengths[i-1])))
        a, b = self.vertices[i-1:i+1]
        return tuple(p + (q-p) * fraction for p, q in zip(a, b))

    def travel(self, start, end, spacing):
        intervals = max(1, math.ceil((end-start) / spacing))
        return [self.at(start + (end-start) * i / intervals) for i in range(intervals+1)]

    def gap(self, candidate):
        # Project onto every road segment in a local metric plane to pick an actual detour.
        scale = 111195
        east = scale * math.cos(math.radians(candidate[0]))
        xy = [((p[1]-candidate[1]) * east, (p[0]-candidate[0]) * scale) for p in self.vertices]
        best = math.inf
        for (x,y), (u,v) in zip(xy, xy[1:]):
            dx, dy = u-x, v-y
            t = max(0, min(1, -(x*dx+y*dy)/(dx*dx+dy*dy)))
            best = min(best, math.hypot(x+t*dx, y+t*dy))
        return best

    def replay(self, moving_lock=False):
        (turn1, text1), (turn2, text2), (turn3, text3) = self.turns[:3]
        approach_end = min(60, turn1*0.55)
        checkpoint = turn1 + min(48, (turn2-turn1)*0.3)
        after_lock = turn2 + min(60, (turn3-turn2)*0.3)
        assert 20 < approach_end < turn1 < checkpoint < turn2 < after_lock < turn3 < self.lengths[-1]
        resumed = after_lock if moving_lock else checkpoint
        rejoined = resumed + min(46, ((turn3 if moving_lock else turn2) - resumed) * 0.22)
        center = self.at(rejoined)
        north, east = 1/111195, 1/(111195*math.cos(math.radians(center[0])))
        # Reach outside the 35m road corridor in two moderate changes, then return
        # within the 12s automatic rerouting window. The test dwells outside for 3s.
        def offset(bearing, distance):
            return (center[0]+distance*north*math.cos(bearing), center[1]+distance*east*math.sin(bearing))
        bearing = max((math.radians(i*15) for i in range(24)), key=lambda a: self.gap(offset(a,78)))
        assert self.gap(offset(bearing,78)) > 55
        handoff_end = checkpoint + (turn2 - checkpoint)*0.68
        stages = {
            "approach": self.travel(8, approach_end, 10),
            "crossing": self.travel(approach_end, checkpoint, 12),
            "handoff": self.travel(checkpoint, handoff_end, 2.5) if moving_lock else [],
            "lockedCrossing": self.travel(handoff_end, after_lock, 15) if moving_lock else [],
            "reacquire": self.travel(resumed, rejoined, 6),
            # Continuous movement provides four genuinely different outside-corridor
            # fixes. Return promptly, before the 12s automatic rerouting threshold.
            "detour": [center] + [offset(bearing, n) for n in (24,48,56,64,72,80)],
            "rejoin": [offset(bearing, 49), offset(bearing, 24)] + self.travel(rejoined, rejoined+16, 5),
            # Brake over the final metres so Core Location actually delivers the
            # successive fixes required by the six-second destination dwell.
            "finish": (self.travel(rejoined+16, self.lengths[-1]-13, 27)
                       + self.travel(self.lengths[-1]-13, self.lengths[-1], 1.4)[1:]),
        }
        return {"firstInstruction":text1,"secondInstruction":text2,"thirdInstruction":text3,
                **{k:[{"latitude":round(p[0],8),"longitude":round(p[1],8)} for p in points]
                   for k,points in stages.items()}}


def alternative_replay(replay, response):
    # Read the independently captured official response as ordered road features.
    # Only the runner gets these coordinates. The installed app requests its own route.
    steps = []
    for feature in response["features"]:
        geometry, attrs = feature["geometry"], feature["properties"]
        if geometry["type"] == "Point":
            steps.append({"instruction": attrs["description"], "turnType": str(attrs["turnType"])})
        elif geometry["type"] == "LineString":
            steps.append({"pathCoords": [{"lat": lat, "lng": lng} for lng, lat in geometry["coordinates"]]})
    road = Trip({"guideSteps": steps})
    first, second = road.turns[:2]
    start = replay["detour"][-1]
    target = replay["finish"][-1]
    assert meters((start["latitude"], start["longitude"]), road.vertices[0]) < 20
    assert meters((target["latitude"], target["longitude"]), road.vertices[-1]) < 20
    assert first[0] >= 6 and second[0] - first[0] >= 35
    assert first[1] != replay["secondInstruction"] and second[1] != replay["secondInstruction"]
    # A few metres along the new street followed by its first junction, then the
    # rest of the independently captured road, including a slow final approach.
    middle = first[0] + 0.45 * (second[0] - first[0])
    def points(coords):
        return [{"latitude": round(lat, 8), "longitude": round(lng, 8)} for lat, lng in coords]
    # Snapping a few metres farther along the street changes TMAP's total link
    # distance. Match its actual decision and street through the second junction.
    first_action, second_action = (text.split(" 따라 ", 1)[0] for text in (first[1], second[1]))
    assert first_action != second_action and all(action not in replay["secondInstruction"]
                                                 for action in (first_action, second_action))
    return {"firstInstruction": first_action, "secondInstruction": second_action,
            "acquire": points(road.travel(0, min(5, first[0] / 3), 1)),
            "crossing": points(road.travel(3, middle, 7)),
            "finish": points(road.travel(middle, road.lengths[-1] - 13, 27)
                             + road.travel(road.lengths[-1] - 13, road.lengths[-1], 1.4)[1:])}



def verify_schedule(cohort, route, schedule_id=None, fresh=False):
    proof = read(cohort / "readback-proof.json")
    pid = subprocess.check_output(["lsof", "-nP", "-tiTCP:5535", "-sTCP:LISTEN"], text=True).strip()
    assert pid == str(proof["serverPid"])
    command = subprocess.check_output(["ps", "-p", pid, "-o", "command="], text=True)
    assert "OfficialSubwayProductSimulatorServer" in command and "/private/tmp/nolate-transfer-subway-product." in command
    c = read(cohort / "credentials.json")
    assert c["scheduleId"] == proof["scheduleId"] and c["memberId"] == proof["memberId"]
    assert c["email"].startswith("car-guide-") and c["email"].endswith("@example.test")
    def api(path, body=None, token=None):
        headers = {"Content-Type":"application/json"}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(API+path, data=json.dumps(body).encode() if body else None, headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)["data"]
    member = api("/api/member/auth/login", {k:c[k] for k in ("email","password")})
    assert member["id"] == c["memberId"]
    token = member["accessToken"]
    original_id = c["scheduleId"]
    schedule = api("/api/schedules/"+str(schedule_id or original_id), token=token)
    assert schedule["ownerMemberId"] == c["memberId"] and schedule["title"] == proof["title"]
    if fresh and schedule["myDepartedAt"] is not None:
        # Retain the previous departure and evidence. The retry starts from a new
        # unstarted personal schedule through the same ordinary schedule API.
        start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=90)
        cloned = api("/api/schedules", {
            "title":schedule["title"], "startAt":start.isoformat(),
            "departAt":(start - datetime.timedelta(minutes=route["minutes"])).isoformat(),
            "category":{k:schedule["category"][k] for k in ("id","title","color")},
            "travelMode":"CAR","travelMinutes":route["minutes"],"notificationEnabled":False,
            "origin":schedule["origin"],"destination":schedule["destination"],"route":route,
        }, token=token)
        assert cloned["id"] != original_id
        schedule = api("/api/schedules/"+str(cloned["id"]), token=token)
        assert schedule["myDepartedAt"] is None
    saved = (schedule.get("myTravelPlan") or {}).get("route") or schedule.get("route")
    assert schedule["travelMode"] == "CAR" and saved == route
    return {**c,"scheduleId":schedule["id"]}, schedule


def verify_speech_windows(output):
    items = read(output / "attachments" / "manifest.json")[0]["attachments"]
    proof, = [row for row in items if row["suggestedHumanReadableName"].startswith("driving-speech-windows")]
    times = read(output / "attachments" / proof["exportedFileName"])
    events = []
    for line in (output / "speech.ndjson").read_text().splitlines():
        if not line.startswith("{"):
            continue
        item = json.loads(line)
        if item.get("category") != "DrivingVoice" or item.get("subsystem") != "com.anonymous.nolatefe":
            continue
        name = item.get("eventMessage")
        if name in ("Korean driving speech started", "Driving speech finished"):
            at = datetime.datetime.fromisoformat(item["timestamp"]).timestamp()
            events.append((at, name, item["processID"]))
    def matching(start, end, name):
        return [pid for at, event, pid in events if times[start] <= at < times[end] and event == name]
    states = {}
    for start, end, enabled in (("initial", "enabled", False), ("enabled", "muted", True),
                                ("muted", "enabledAgain", False), ("enabledAgain", "closing", True),
                                ("relaunched", "finalMute", True), ("finalMute", "end", False)):
        starts = matching(start, end, "Korean driving speech started")
        finishes = matching(start, end, "Driving speech finished")
        assert bool(starts) is enabled, (start, "unexpected Korean speech start count", len(starts))
        if enabled:
            assert finishes, (start, "no completed speech")
        states[start] = {"koreanSpeechStarts": len(starts), "speechFinishes": len(finishes)}
    assert set(matching("enabledAgain", "closing", "Korean driving speech started")).isdisjoint(
        matching("relaunched", "finalMute", "Korean driving speech started")), "App process must have changed"
    (output / "speech-proof.json").write_text(json.dumps(states, indent=2))


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("cohort", type=Path)
    cli.add_argument("--prepare-only", action="store_true", help="Re-read isolated saved schedule and check replay without touching a simulator")
    cli.add_argument("--app", type=Path)
    cli.add_argument("--udid")
    cli.add_argument("--reuse-installed", action="store_true", help="Use an identical signed installation after a previous test")
    locking = cli.add_mutually_exclusive_group()
    locking.add_argument("--voice", action="store_true", help="Exercise the driving voice switch, native speech and app relaunch")
    locking.add_argument("--reroute-response", type=Path, metavar="FILE",
                         help="Verify automatic rerouting using an independent TMAP response captured at the detour")
    locking.add_argument("--lock", action="store_true", help="Tap the live route card and resume the active drive")
    locking.add_argument("--lock-moving", action="store_true", help="Keep driving through the next maneuver while locked, then tap the real card and drive to arrival")
    locking.add_argument("--lock-source-loss", action="store_true",
                         help="Separate scenario revoking only this simulator app's location permission while locked")
    args = cli.parse_args()
    os.umask(0o077)
    cohort = args.cohort.resolve()
    assert cohort.parent == Path("/private/tmp") and cohort.name.startswith("nolate-car-guidance-")
    route = read(cohort / "product-route.json")
    assert (route["mode"], route["provider"], route["source"], route["drivingGeometryComplete"]) == ("CAR","tmap","api",True)
    c, _ = verify_schedule(cohort, route)
    replay = Trip(route).replay(moving_lock=args.lock_moving or args.lock_source_loss)
    if args.reroute_response:
        replay["alternative"] = alternative_replay(replay, read(args.reroute_response))
    fixture = json.dumps(replay, ensure_ascii=False, separators=(",",":"))
    assert len(fixture.encode()) <= 24576
    print("Verified isolated CAR schedule", c["scheduleId"], "with", len(route["guideSteps"]), "guide steps.",
          "Independent detour response verified." if args.reroute_response else "Saved route replay ready.",
          flush=True)
    if args.prepare_only:
        return
    if not args.app or not args.udid:
        cli.error("--app and --udid are required for simulator execution")
    info = plistlib.loads((args.app / "Info.plist").read_bytes())
    assert info["CFBundleIdentifier"] == "com.anonymous.nolatefe" and info["CFBundleSupportedPlatforms"] == ["iPhoneSimulator"]
    js = (args.app / "main.jsbundle").read_bytes()
    assert b"127.0.0.1:5535" in js and b"driving-navigation-instruction" in js
    inventory = json.loads(subprocess.check_output(["xcrun","simctl","list","devices","booted","--json"]))
    assert args.udid == DEVICE
    assert any(d["udid"] == args.udid and d["name"].startswith("NoLate Notice E2E Isolated")
               for group in inventory["devices"].values() for d in group)
    c, schedule = verify_schedule(cohort, route, fresh=True)
    assert schedule["myDepartedAt"] is None
    def sim(*params, check=True):
        return subprocess.run(["xcrun","simctl",*params], check=check, timeout=60,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    output = cohort / ("simulator-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    output.mkdir(mode=0o700)
    if args.reuse_installed:
        installed = Path(subprocess.check_output(["xcrun","simctl","get_app_container",args.udid,
                                                  info["CFBundleIdentifier"],"app"],text=True).strip())
        extensions = list((args.app / "PlugIns").glob("*.appex"))
        attest = ["main.jsbundle", info["CFBundleExecutable"], "Info.plist"]
        for ext in extensions:
            name = plistlib.loads((ext / "Info.plist").read_bytes())["CFBundleExecutable"]
            attest.append((ext / name).relative_to(args.app))
        for file in attest:
            assert hashlib.sha256((installed/file).read_bytes()).digest() == hashlib.sha256((args.app/file).read_bytes()).digest()
    else:
        sim("location", args.udid, "clear")
        sim("uninstall", args.udid, info["CFBundleIdentifier"], check=False)
        sim("install", args.udid, str(args.app))
    sim("privacy", args.udid, "grant", "location", info["CFBundleIdentifier"])
    scheme = Path(__file__).resolve().parent / "NoLateE2E.xcodeproj"
    # App uninstall may retain iOS Keychain. The UI may sign out only the preceding
    # fixture member on this exact JVM, or the current isolated car account.
    pid = str(read(cohort / "readback-proof.json")["serverPid"])
    proc = subprocess.check_output(["ps","-p",pid,"-o","command="],text=True)
    prior = next(p for p in Path("/private/tmp").glob("nolate-transfer-subway-product.*/fixture-scope.json")
                 if str(p.parent) in proc and read(p).get("port") == 5535)
    prior_email = read(prior.parent / "credentials.json")["email"]
    assert prior_email.endswith("@example.test")
    env = {**os.environ,"TEST_RUNNER_E2E_PREVIOUS_FIXTURE_EMAIL":prior_email,"TEST_RUNNER_E2E_CAR_REPLAY":fixture,"TEST_RUNNER_E2E_SCHEDULE_ID":str(c["scheduleId"]),
           "TEST_RUNNER_E2E_PASSWORD":c["password"],"TEST_RUNNER_E2E_EMAIL":c["email"],
           "TEST_RUNNER_E2E_CAR_LOCK":"1" if args.lock or args.lock_moving or args.lock_source_loss else "0",
           "TEST_RUNNER_E2E_CAR_LOCK_MOVING":"1" if args.lock_moving or args.lock_source_loss else "0"}
    revoked = False
    test = TEST
    if args.voice:
        test = VOICE_TEST
    elif args.reroute_response:
        test = REROUTE_TEST
    elif args.lock_source_loss:
        test = LOSS_TEST
    result = output / "Result.xcresult"
    previous_style = subprocess.check_output(["xcrun","simctl","ui",args.udid,"appearance"], text=True).strip()
    assert previous_style in ("light","dark"), "Need a restorable simulator appearance"
    print("Running on designated isolated simulator. Evidence:", output, flush=True)
    speech_log = None
    try:
        if args.voice:
            with (output / "speech.ndjson").open("w") as file:
                speech_log = subprocess.Popen(["xcrun", "simctl", "spawn", args.udid, "log", "stream", "--style", "ndjson",
                    "--level", "info", "--predicate", 'subsystem == "com.anonymous.nolatefe" AND category == "DrivingVoice"'],
                    stdout=file, stderr=subprocess.DEVNULL, start_new_session=True)
        sim("ui", args.udid, "appearance", "dark")
        with (output / "test.log").open("w", buffering=1) as log:
            run = subprocess.Popen(["xcodebuild","-project",str(scheme),"-scheme","NoLateE2E","-destination",
               "platform=iOS Simulator,id="+args.udid,"-parallel-testing-enabled","NO","-test-timeouts-enabled","YES",
               "-collect-test-diagnostics","never","-default-test-execution-time-allowance","600","-maximum-test-execution-time-allowance","720","-derivedDataPath",
               str(cohort/"runner-build"),"-resultBundlePath",str(result),"-only-testing:"+test,"test"],
               env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
            for line in run.stdout:
                log.write(line)
                if "E2E_CAR_LOCK_REVOKE_LOCATION" in line and args.lock_source_loss and not revoked:
                    sim("privacy", args.udid, "revoke", "location", info["CFBundleIdentifier"])
                    revoked = True
                    (output / "source-loss-proof.json").write_text(json.dumps({
                        "udid":args.udid, "bundleId":info["CFBundleIdentifier"],
                        "revokedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "simctlPrivacyRevokeExit":0,
                    }, indent=2))
                if "E2E_CAR_LOCK_" in line:
                    print(line.strip(), flush=True)
            status = run.wait()
            if status:
                raise SystemExit(status)
        summary = json.loads(subprocess.check_output(["xcrun","xcresulttool","get","test-results","summary","--path",str(result)]))
        assert summary["passedTests"] == 1 and summary["failedTests"] == 0 and summary["skippedTests"] == 0
        subprocess.run(["xcrun","xcresulttool","export","attachments","--path",str(result),
                        "--output-path",str(output / "attachments")], check=True, stdout=subprocess.DEVNULL)
        if speech_log:
            assert speech_log.poll() is None, "Simulator log stream ended during the drive"
            os.killpg(speech_log.pid, signal.SIGINT)
            speech_log.wait(timeout=15)
            verify_speech_windows(output)
        assert not args.lock_source_loss or revoked
        _, after = verify_schedule(cohort, route, schedule_id=c["scheduleId"])
        assert after["myDepartedAt"], "Verified motion must also record a real departure on this member's plan"
        (output / "departure-proof.json").write_text(json.dumps({
            "scheduleId":c["scheduleId"],"memberId":c["memberId"],"departureBefore":None,
            "departureAfter":after["myDepartedAt"],"unchangedSavedTurnCount":len(route["guideSteps"]),
        }, indent=2))
        print("Passed saved driving route E2E, including recorded departure.", flush=True)
    finally:
        if speech_log and speech_log.poll() is None:
            os.killpg(speech_log.pid, signal.SIGTERM)
            speech_log.wait(timeout=10)
        # The XCTest's defer restores XCUIDevice.location on every exit. Restoring
        # appearance first keeps it independent of CoreSimulator location services.
        try:
            if revoked:
                sim("privacy", args.udid, "grant", "location", info["CFBundleIdentifier"])
        finally:
            sim("ui", args.udid, "appearance", previous_style)


if __name__ == "__main__":
    main()

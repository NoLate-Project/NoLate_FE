"""Drive the saved Seoul Station → Chungmuro → Gyeongbokgung route on a dedicated iOS simulator.

Start OfficialSubwayProductSimulatorServer with transfer-subway-replay=true in a fresh
private cohort containing the product route, places, official topology and TMAP captures.
The UI and the Seoul observation transport receive separate input streams. No application
test screen, phase override, remote notification, or physical device is used.
"""
import argparse
import bisect
import datetime
import json
import math
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import time


def coord(point):
    return point["lat"], point["lng"]


def distance(a, b):
    y = math.radians(b[0] - a[0])
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, y)


class PathWalk:
    def __init__(self, coordinates):
        self.points = [coordinates[0]]
        self.distances = [0.0]
        for point in coordinates[1:]:
            step = distance(self.points[-1], point)
            if step > 0.01:
                self.points.append(point)
                self.distances.append(self.distances[-1] + step)
        self.length = self.distances[-1]
        assert self.length > 0

    def at(self, meters):
        if meters <= 0:
            return self.points[0]
        if meters >= self.length:
            return self.points[-1]
        i = bisect.bisect_right(self.distances, meters)
        portion = (meters - self.distances[i - 1]) / (self.distances[i] - self.distances[i - 1])
        return tuple(a + (b - a) * portion for a, b in zip(self.points[i - 1], self.points[i]))

    def station_distances(self, stops):
        offsets = []
        for stop in stops:
            nearest = min(range(len(self.points)), key=lambda i: distance(self.points[i], stop))
            assert distance(self.points[nearest], stop) < 50, "ODsay station did not match the saved track"
            offsets.append(self.distances[nearest])
        assert all(a < b for a, b in zip(offsets, offsets[1:]))
        return offsets


def read(path):
    return json.loads(path.read_text())


def tmap_path(cohort, index):
    features = read(cohort / f"walk-{index}.json")["features"]
    return [(y, x) for feature in features if feature["geometry"]["type"] == "LineString"
            for x, y in feature["geometry"]["coordinates"]]


class PassengerTrip:
    def __init__(self, directory, platform_wait=0):
        self.directory = directory
        legs = read(directory / "product-route.json")["transitLegs"]
        assert [leg["kind"] for leg in legs] == ["WALK", "SUBWAY", "WALK", "SUBWAY", "WALK"]
        stops = {i: [coord(stop["coord"]) for stop in legs[i]["navigationEvidence"]["stopOccurrences"]]
                 for i in (1, 3)}
        self.tracks = {i: PathWalk(list(map(coord, legs[i]["pathCoords"]))) for i in (1, 3)}
        self.offsets = {i: self.tracks[i].station_distances(stops[i]) for i in (1, 3)}
        # The person moves from the sidewalk to the boarding platform. The saved route and
        # the independently supplied provider geometry are never edited for the replay.
        self.first = PathWalk(tmap_path(directory, 0) + [stops[1][0]])
        self.transfer = PathWalk(list(map(coord, legs[2]["pathCoords"])) + [stops[3][0]])
        self.final = PathWalk(tmap_path(directory, 4))
        assert legs[2]["navigationEvidence"]["geometryInputComplete"]
        assert legs[2]["pathGeometrySource"] == "WALK_STEPS_LINESTRING"
        self.train1 = self.first.length / 2.1 + 7 + platform_wait
        self.exit1 = self.train1 + 55 * (len(stops[1]) - 1) + 15
        self.train3 = self.exit1 + self.transfer.length / 1.35 + 30
        self.exit3 = self.train3 + 55 * (len(stops[3]) - 1) + 15

    def start_clocks(self, start):
        for index, offset in ((1, self.train1), (3, self.train3)):
            with (self.directory / f"train-{index}-start-at").open("x") as stream:
                # Provider reports the train at the station eight seconds before the passenger
                # timeline. The streams agree over a dwell, never by identical timestamps.
                stream.write(str(round((start + offset - 8) * 1000)))

    def on_train(self, index, elapsed):
        offsets = self.offsets[index]
        i = max(0, min(int(elapsed // 55), len(offsets) - 1))
        if i == len(offsets) - 1:
            return self.tracks[index].at(offsets[i])
        # Passenger departs after a platform dwell, crosses the whole saved track in
        # continuous one-second samples, then dwells at the observed next station.
        fraction = max(0.0, min(1.0, (elapsed - i * 55 - 19) / 36))
        return self.tracks[index].at(offsets[i] + (offsets[i + 1] - offsets[i]) * fraction)

    def sample(self, elapsed):
        if elapsed < self.train1:
            return self.first.at(max(0.0, elapsed) * 2.1)
        if elapsed < self.exit1:
            return self.on_train(1, elapsed - self.train1)
        if elapsed < self.train3:
            return self.transfer.at((elapsed - self.exit1) * 1.35)
        if elapsed < self.exit3:
            return self.on_train(3, elapsed - self.train3)
        return self.final.at((elapsed - self.exit3) * 1.55)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cohort", type=Path)
    parser.add_argument("app", type=Path)
    parser.add_argument("udid")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--lock", action="store_true", help="Operator locks the designated independent window on LOCK_READY")
    mode.add_argument("--verify-transfer-copy", action="store_true",
                      help="Verify the recovered transfer sheet and stop in the app before boarding the second train")
    mode.add_argument("--verify-walking-heading", action="store_true",
                      help="Follow passenger fixes to the platform and verify walking direction disappears while waiting")
    mode.add_argument("--verify-platform-notice", action="store_true",
                      help="Verify a source-timestamped train ETA, Korean speech and an iOS notification on the saved route")
    mode.add_argument("--verify-next-train", action="store_true",
                      help="Stay at the platform while the first train departs and verify the following service is announced")
    args = parser.parse_args()
    platform_notice = args.verify_platform_notice or args.verify_next_train
    cohort = args.cohort.resolve()
    assert cohort.parent == Path("/private/tmp") and cohort.name.startswith("nolate-transfer-subway-product.")
    scope = read(cohort / "fixture-scope.json")
    assert scope["port"] == 5535 and scope["trainProvider"] == "INDEPENDENT_STATION_CLOCKS" and scope["deviceEnabled"] is False
    assert scope["walkingProvider"] == "CAPTURED_TMAP_PEDESTRIAN" and scope["firebaseEnabled"] is False
    assert not any((cohort / f"train-{i}-start-at").exists() for i in (1, 3))
    info = plistlib.loads((args.app / "Info.plist").read_bytes())
    assert info["CFBundleIdentifier"] == "com.anonymous.nolatefe"
    assert info["CFBundleSupportedPlatforms"] == ["iPhoneSimulator"] and info["NoLateJourneyProductEnabled"] is True
    assert b"127.0.0.1:5535" in (args.app / "main.jsbundle").read_bytes()
    inventory = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "booted", "--json"]))
    assert any(device["udid"] == args.udid and device["name"].startswith("NoLate Notice E2E Isolated")
               for group in inventory["devices"].values() for device in group)
    trip = PassengerTrip(cohort, platform_wait=135 if platform_notice else 0)
    output = cohort / "simulator-e2e"
    output.mkdir(mode=0o700)
    credentials = read(cohort / "credentials.json")
    env = {**os.environ, "TEST_RUNNER_E2E_EMAIL": credentials["email"], "TEST_RUNNER_E2E_PASSWORD": credentials["password"],
           "TEST_RUNNER_E2E_SCHEDULE_ID": str(scope["scheduleId"]), "TEST_RUNNER_E2E_SUBWAY_TRANSFER_FULL_TRIP": "1",
           "TEST_RUNNER_E2E_SUBWAY_NEXT_TRAIN": "1" if args.verify_next_train else "0",
           "TEST_RUNNER_E2E_SUBWAY_PLATFORM_NOTICE": "1" if platform_notice else "0",
           "TEST_RUNNER_E2E_SUBWAY_WALKING_HEADING_ONLY": "1" if args.verify_walking_heading else "0",
           "TEST_RUNNER_E2E_SUBWAY_TRANSFER_LOCK": "1" if args.lock else "0",
           "TEST_RUNNER_E2E_SUBWAY_TRANSFER_COPY_ONLY": "1" if args.verify_transfer_copy else "0"}
    def sim(*actions, check=True, timeout=45):
        return subprocess.run(["xcrun", "simctl", *actions], check=check, timeout=timeout,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def gps(location, elapsed):
        lat, lng = location
        # Continued idealized fixes at a stop, with <0.3m of deterministic variation.
        sim("location", args.udid, "set", f"{lat + math.sin(elapsed) * 0.000002:.9f},{lng:.9f}")

    sim("location", args.udid, "clear")
    if sim("get_app_container", args.udid, info["CFBundleIdentifier"], check=False, timeout=120).returncode == 0:
        sim("uninstall", args.udid, info["CFBundleIdentifier"], timeout=120)
    sim("install", args.udid, str(args.app), timeout=180)
    project = Path(__file__).resolve().parent / "NoLateE2E.xcodeproj"
    cmd = ["xcodebuild", "-project", str(project), "-scheme", "NoLateE2E", "-destination",
           f"platform=iOS Simulator,id={args.udid}", "-parallel-testing-enabled", "NO",
           "-derivedDataPath", str(output / "derived"), "-resultBundlePath", str(output / "result.xcresult"),
           "-only-testing:NoLateE2ETests/NoLateE2ETests/testIsolatedSavedRouteNavigationEntry", "test"]
    started = None
    run_log = output / "run.log"
    deadline = time.monotonic() + 1800
    notice_log = None
    try:
        if platform_notice:
            (cohort / "replay-platform-arrival").touch(exist_ok=False)
            if args.verify_next_train:
                (cohort / "replay-following-train").touch(exist_ok=False)
            with (output / "notice.ndjson").open("w") as f:
                notice_log = subprocess.Popen(["xcrun","simctl","spawn",args.udid,"log","stream","--style","ndjson",
                    "--level","info","--predicate",'process == "NoLateFE" AND eventMessage BEGINSWITH "NOLATE_GUIDANCE_NOTICE"'],
                    stdout=f, stderr=subprocess.DEVNULL, start_new_session=True)
        gps(trip.first.at(0), 0.0)
        with run_log.open("wb") as log, subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT) as proc:
            try:
                announced_lock = False
                gap_started = None
                gap_finished = False
                contention_requested = False
                while proc.poll() is None:
                    evidence = run_log.read_text(errors="replace")
                    if (started is None and args.verify_walking_heading and "E2E_TRANSIT_DEPARTURE_REQUESTED" in evidence
                            and "E2E_SUBWAY_TRANSFER_ARMED" not in evidence):
                        gps(trip.first.at(0), time.monotonic())
                    if started is None and "E2E_SUBWAY_TRANSFER_ARMED" in evidence:
                        started_at = time.time()
                        trip.start_clocks(started_at)
                        started = time.monotonic()
                        print("GPS and separate train clocks started", flush=True)
                    if not announced_lock and "E2E_SUBWAY_TRANSFER_LOCK_READY" in evidence:
                        print("LOCK_READY", flush=True)
                        announced_lock = True
                    if started is not None:
                        elapsed = time.monotonic() - started
                        if not platform_notice and not contention_requested and elapsed >= 65:
                            (cohort / "lease-contention-requested").touch(exist_ok=False)
                            contention_requested = True
                        # Only the passenger device loses its updates. The provider's
                        # two trains continue independently during the outage.
                        if gap_started is None and "E2E_SUBWAY_SEGMENT_GPS_GAP" in evidence:
                            sim("location", args.udid, "clear")
                            gap_started = time.monotonic()
                        if gap_started is not None and not gap_finished:
                            duration = time.monotonic() - gap_started
                            if duration >= 18 and "E2E_SUBWAY_SEGMENT_GPS_GAP_VERIFIED" in evidence:
                                gap_finished = True
                                print(f"Passenger GPS resumed after {duration:.1f}s without updates", flush=True)
                            elif duration > 35:
                                raise TimeoutError("The app did not withdraw the measured segment during passenger GPS loss")
                        if gap_started is None or gap_finished:
                            point = trip.first.at(elapsed * 2.1) if args.verify_next_train else trip.sample(elapsed)
                            gps(point, elapsed)
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Product route did not reach its terminal state in time")
                    time.sleep(0.8)
            finally:
                if proc.poll() is None:
                    proc.terminate()
                    proc.wait(timeout=45)
        if proc.returncode:
            raise SystemExit(proc.returncode)
        if platform_notice:
            assert started is not None and "E2E_SUBWAY_PLATFORM_NOTICE_VERIFIED" in run_log.read_text()
            assert notice_log and notice_log.poll() is None, "iOS notice stream ended during the test"
            os.killpg(notice_log.pid, signal.SIGINT)
            notice_log.wait(timeout=15)
            events = [json.loads(line) for line in (output / "notice.ndjson").read_text().splitlines() if line.startswith("{")]
            first_due = int((cohort / "train-1-start-at").read_text()) / 1000
            # The replay starts reporting the following train four seconds after the first is due.
            windows = {"90401": (started_at, first_due + 4)}
            if args.verify_next_train:
                windows["90402"] = (first_due + 4, first_due + 108)
            counts = {}
            for number, (start, end) in windows.items():
                messages = [e["eventMessage"] for e in events if e.get("timestamp") and e.get("eventMessage")
                            and start <= datetime.datetime.fromisoformat(e["timestamp"]).timestamp() < end]
                counts[number] = {name: messages.count(f"NOLATE_GUIDANCE_NOTICE {name} kind=ARRIVAL_SOON")
                                  for name in ("selected", "submit_accepted", "speech_started", "speech_finished")}
                # The rider is in NoLate for the first service and on the Home Screen for the next.
                spoken = int(number == "90401")
                assert counts[number] == {"selected": 1, "submit_accepted": 1,
                                          "speech_started": spoken, "speech_finished": spoken}, counts
            rows = [json.loads(line)["data"].get("arrivalInput") for line in (cohort / "subway-responses.jsonl").read_text().splitlines()]
            arrivals = [a for a in rows if a and a["terminalStationName"] == "진접"]
            trains = {a["trainNumber"] for a in arrivals}
            assert trains == ({"90401", "90402"} if args.verify_next_train else {"90401"})
            updates = {t: len({a["sourceUpdatedAt"] for a in arrivals if a["trainNumber"] == t}) for t in trains}
            assert all(n >= 2 for n in updates.values()) and all(a["confirmedBoarding"] is False for a in arrivals)
            estimates = {a["expectedAt"] for a in arrivals if a["trainNumber"] == "90401"}
            assert len(estimates) == (2 if args.verify_next_train else 1)
            proof = {"providerUpdatesByTrain": updates, "firstTrainEstimates": len(estimates), "noticeEventsByTrain": counts}
            (output / "platform-proof.json").write_text(json.dumps(proof, indent=2))
            print("Verified independent arrival refreshes, visible iOS notice and Korean speech", proof, flush=True)
            return
        if args.verify_walking_heading:
            assert started is not None and "E2E_SUBWAY_WALKING_HEADING_VERIFIED" in run_log.read_text()
            assert "E2E_TRANSIT_READY_AT_MEASURED_ORIGIN" in run_log.read_text()
            print("Stationary origin, walking direction and platform passed", flush=True)
            return
        completion = "E2E_SUBWAY_TRANSFER_COPY_COMPLETE" if args.verify_transfer_copy else "E2E_SUBWAY_TRANSFER_COMPLETE"
        assert started is not None and gap_finished and completion in run_log.read_text()
        leases = [json.loads(line) for line in (cohort / "lease-contention.jsonl").read_text().splitlines()]
        blocked = next(row for row in leases if row["locked"])
        assert blocked["status"] == 503 and blocked["errorCode"] == "JOURNEY_STORAGE_BUSY"
        assert any(not row["locked"] and row["status"] == 200 and row["state"] == "ACTIVE"
                   and row["sessionId"] == blocked["sessionId"] for row in leases)
        observed = [json.loads(row) for row in (cohort / "subway-responses.jsonl").read_text().splitlines()]
        inputs = [row["data"] for row in observed if row["httpStatus"] == 200 and row["data"].get("nativeInput")]
        expected_trains = [(1, "90401", 4)]
        if not args.verify_transfer_copy:
            expected_trains.append((3, "90303", 5))
        for index, train, count in expected_trains:
            indices = {t["stopIndex"] for item in inputs if item.get("subwayLegIndex") == index
                       for t in item["nativeInput"]["trains"] if t["id"] == train}
            assert indices == set(range(count)), f"Incomplete independent station coverage for leg {index}: {indices}"
        print("Recovered transfer copy and in-app stop passed" if args.verify_transfer_copy
              else "Saved two-line subway transfer passed", flush=True)
    finally:
        if notice_log and notice_log.poll() is None:
            os.killpg(notice_log.pid, signal.SIGINT)
            notice_log.wait(timeout=15)
        if platform_notice:
            (cohort / "replay-platform-arrival").unlink(missing_ok=True)
            (cohort / "replay-following-train").unlink(missing_ok=True)
        sim("location", args.udid, "clear")
        for index in (1, 3):
            (cohort / f"train-{index}-start-at").unlink(missing_ok=True)


if __name__ == "__main__":
    main()

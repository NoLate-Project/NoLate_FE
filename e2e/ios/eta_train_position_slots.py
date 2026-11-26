"""Budget real position reads across boarding and alighting on both legs of the isolated journey."""
import datetime as dt
import re
from eta_observed_service import observed_service, selected_train_number

from eta_planned_route_evidence import verified_timetable_plan


OFFSETS_SECONDS = (-120, -15, 90, 195)
CORRIDOR = (('LINE_4', '노원', '사당', '0411', '0433'), ('LINE_2', '사당', '신림', '0226', '0230'))
MAX_READS = len(CORRIDOR) * 2 * len(OFFSETS_SECONDS)


def _instant(text):
    at = dt.datetime.fromisoformat(text.replace('Z', '+00:00'))
    if at.utcoffset() is None:
        raise ValueError('Missing station clock offset')
    return at


class JourneyPositionSlots:
    def __init__(self):
        self.identity = None
        self.original_departure = None
        self.service_date = None
        self.deadline = None
        self.pending = {}
        self.spent = set()
        self.last_receipt = {}
        self.log = []
        self.plans = []

    def apply_evaluation(self, index, worker, now):
        if (worker.get('classification') != 'REAL_PROVIDER_ISOLATED_WORKER' or worker.get('providersMocked') is not False
                or worker.get('clockMode') != 'SYSTEM_WALL_CLOCK' or worker.get('database') != 'H2_MEMORY_ONLY'
                or worker.get('journeyProvider') != 'odsay' or not 1 <= index <= 3 or _instant(worker['evaluatedAt']) > now):
            raise ValueError('Invalid real observation fixture')
        snapshot = worker.get('effectiveSnapshot') or {}
        if snapshot.get('routeChanged') is not False:
            self.identity = None
            self.pending.clear()
            return
        if index == 1:
            if snapshot.get('transitRouteProvenance') != 'SELECTED_ROUTE_PRESERVED':
                return
            accepted = (worker.get('source') == 'LIVE_PROVIDER' and worker.get('stale') is False
                        and worker.get('failureReason') is None and snapshot.get('accepted') is True)
            source = 'effectiveTransitRoute' if accepted else 'lastTimetablePlannedRoute'
            route = snapshot.get(source) if accepted else verified_timetable_plan(worker)
            if route is None:
                return
            departure = _instant(route['departureAt'])
            if departure > now + dt.timedelta(hours=1):
                raise ValueError('Journey departure exceeds isolated waiting horizon')
            # A fixed public-map comparison can start well before the journey.
            # Count the travel observation window from departure in that case.
            self.deadline = max(now, departure) + dt.timedelta(minutes=90)
        else:
            if not self.identity:
                return
            update = snapshot.get('plannedRouteUpdate') or {}
            original = snapshot.get('inProgressPlannedRoute') or {}
            if update.get('failure'):
                # Follow the last issued trains even when the Worker withdraws its ETA.
                # These reads still belong to the earlier prediction, under its original budget.
                if (update.get('routeIdentity') != self.identity or original.get('identity') != self.identity
                        or not original.get('departureAt') or _instant(original['departureAt']) != self.original_departure):
                    self.identity = None
                    self.pending.clear()
                return
            if original.get('identity') != self.identity:
                raise ValueError('Original journey changed during observation')
            observation = snapshot.get('plannedArrivalObservation') or {}
            candidates = [('plannedRouteUpdate.route', update.get('route')),
                          ('plannedArrivalObservation.effectiveTransitRoute', observation.get('effectiveTransitRoute')),
                          ('lastUpdatedPlannedRoute', snapshot.get('lastUpdatedPlannedRoute'))]
            latest = next(((key, plan) for key, plan in candidates if plan), None)
            if latest is None:
                return
            source, route = latest
        rides = [leg for leg in route['segments'] if leg['kind'] != 'WALK']
        if (not route.get('identity') or route.get('provider') != 'odsay' or len(rides) != len(CORRIDOR)
                or (index > 1 and (self.identity != route['identity'] or
                                    self.original_departure != _instant(route['departureAt'])))):
            raise ValueError('Unrelated position observation journey')
        # Slots already missed while a Worker request was in flight cannot be reclaimed on a later train.
        for key, old in self.pending.items():
            if now - old['at'] > dt.timedelta(seconds=12):
                self.spent.add(key)
                self.log.append({**old, 'at': old['at'].isoformat(), 'status': 'MISSED_CLOCK_WINDOW'})
        service_dates = set()
        pending = {}
        for ride, (line, start, end, start_id, end_id) in zip(rides, CORRIDOR):
            timing = ride['rideTiming']
            service = observed_service(ride)
            table = timing['timetable']
            service_dates.add(table['serviceDate'])
            if ((ride['kind'], ride['fromName'], ride['toName'], table['line'], table['fromStationCode'], table['toStationCode'])
                    != ('SUBWAY', start, end, line, start_id, end_id) or
                    table['provider'] not in ('seoul-timetable', 'seoul-dated-path')):
                raise ValueError('Unexpected observation corridor')
            direction = 'DOWN' if line == 'LINE_4' else 'UP'
            if (not table.get('trainNumber') or not table.get('terminalName') or table.get('directionCode') != direction
                    or table.get('serviceClass') not in ('LOCAL', 'EXPRESS')):
                raise ValueError('Incomplete train identity')
            alias = None if service else table.get('realtimeTrainNumber')
            if alias is not None and not (table['provider'] == 'seoul-timetable' and line == 'LINE_4' and
                    re.fullmatch(r'K[0-9]{4}', table['trainNumber']) and alias == table['trainNumber'][1:]):
                raise ValueError('Unverified realtime train number')
            service_day = dt.date.fromisoformat(table['serviceDate'])
            for field in ('boardingAt', 'arrivalAt'):
                civil = _instant(table[field]).astimezone(dt.timezone(dt.timedelta(hours=9)))
                if civil.date() != service_day and not (civil.date() == service_day + dt.timedelta(days=1) and civil.hour < 3):
                    raise ValueError('Station time outside the designated train service day')
            for event, station, anchor in (('BOARDING', start, timing['predictedBoardingAt']),
                                           ('ALIGHTING', end, timing['predictedArrivalAt'])):
                at = _instant(anchor)
                for ordinal, offset in enumerate(OFFSETS_SECONDS):
                    slot_id = (line, event, ordinal)
                    if slot_id in self.spent:
                        continue
                    due = at + dt.timedelta(seconds=offset)
                    if due > self.deadline:
                        raise ValueError('Observation exceeds isolated journey horizon')
                    service_identity = [table['serviceDate'], selected_train_number(ride), table['directionCode'],
                                        table['serviceClass'], table['terminalName'], start, end]
                    previous = self.pending.get(slot_id)
                    # 같은 편의 더 늦은 예보가 이미 정한 이른 관측을 뒤로 밀면, 종착역에
                    # 도착한 뒤 원본 시각이 만료돼 실제 사건을 잃을 수 있다. 호출 수나 품질
                    # 기준을 늘리지 않고 동일 편의 아직 쓰지 않은 더 이른 시각을 보존한다.
                    if (previous is not None and previous.get('serviceIdentity') == service_identity and
                            previous['at'] < due):
                        pending[slot_id] = previous
                    else:
                        pending[slot_id] = dict(at=due, line=line, event=event, station=station, ordinal=ordinal,
                                                trainNumber=selected_train_number(ride), predictedAt=anchor,
                                                evaluation=index, serviceIdentity=service_identity)
        if len(service_dates) != 1 or (self.service_date and self.service_date not in service_dates):
            raise ValueError('Inconsistent rail service day')
        self.service_date, = service_dates
        self.identity, self.original_departure = route['identity'], _instant(route['departureAt'])
        self.pending = pending
        self.plans.append({'evaluation': index, 'snapshotPath': source, 'selectedAt': now.isoformat()})

    def take_due(self, now):
        """Retire missed slots; a later plan must never spend them again or replay old calls."""
        for key, slot in sorted(self.pending.items(), key=lambda item: item[1]['at']):
            if slot['at'] > now:
                break
            del self.pending[key]
            self.spent.add(key)
            receipt = self.last_receipt.get(slot['line'])
            reason = None
            if now - slot['at'] > dt.timedelta(seconds=12):
                reason = 'MISSED_CLOCK_WINDOW'
            elif receipt is not None and now - receipt <= dt.timedelta(seconds=60):
                reason = 'INSIDE_PROVIDER_CACHE'
            entry = {**slot, 'at': slot['at'].isoformat(), 'status': reason or 'REQUESTED'}
            self.log.append(entry)
            if reason is None:
                return entry
        return None

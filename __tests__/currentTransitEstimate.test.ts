import type { TransitLegDetail, TransitRouteOption } from '../src/modules/map/tmapApiCore';
import { matchCurrentTransitEstimate, transitItineraryKey } from '../src/routeSupport/schedule/useCurrentTransitEstimate';

jest.mock('../src/modules/map/odsayApi', () => ({ getOdsayTransitRouteOptions: jest.fn() }));

const ride: TransitLegDetail = {
  kind: 'SUBWAY', label: '2호선', providerRouteId: '1000:2', startID: '229', endID: '222',
};
const route: TransitRouteOption = {
  id: 'current', source: 'api', provider: 'odsay', minutes: 25,
  providerDepartureAt: '2026-11-27T00:57:00+09:00', providerArrivalAt: '2026-11-27T01:22:00+09:00',
  transitLegs: [{ kind: 'WALK', label: '봉천역까지' }, ride],
};
const key = transitItineraryKey([ride])!;
const now = new Date('2026-11-27T00:57:43+09:00');

it('selects the saved ride from the response for the requested minute', () => {
  const differentStop = { ...route, transitLegs: [{ ...ride, endID: '224' }] };
  expect(matchCurrentTransitEstimate([differentStop, route], key, now)).toBe(route);
});

it('omits the clock for a stale, unavailable, fallback or incomplete result', () => {
  const invalid: TransitRouteOption[] = [
    { ...route, providerDepartureAt: '2026-11-26T09:18:00+09:00' },
    { ...route, transitLegs: [{ ...ride, serviceAvailable: false }] },
    { ...route, source: 'fallback' },
    { ...route, providerArrivalAt: undefined },
    { ...route, providerArrivalAt: route.providerDepartureAt },
  ];
  for (const option of invalid) {
    expect(matchCurrentTransitEstimate([option], key, now)).toBeUndefined();
  }
});

it('requires an identifiable ride and preserves transfer order', () => {
  expect(transitItineraryKey([{ kind: 'WALK', label: '도보' }])).toBeUndefined();
  expect(transitItineraryKey([{ kind: 'SUBWAY', label: '2호선' }])).toBeUndefined();
  const next = { ...ride, providerRouteId: '1000:5' };
  expect(transitItineraryKey([ride, next])).not.toBe(transitItineraryKey([next, ride]));
});

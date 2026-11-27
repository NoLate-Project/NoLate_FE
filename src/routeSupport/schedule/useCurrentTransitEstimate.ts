import { useEffect, useState } from 'react';
import { getOdsayTransitRouteOptions } from '../../modules/map/odsayApi';
import type { RouteAlternativeOption, TransitLegDetail, TransitRouteOption } from '../../modules/map/tmapApiCore';
import type { Place } from '../../modules/schedule/types';

export function transitItineraryKey(legs?: TransitLegDetail[]) {
  if (!Array.isArray(legs)) return undefined;
  const rides = legs.filter(leg => leg.kind !== 'WALK');
  if (!rides.length || rides.some(leg => !['BUS', 'SUBWAY'].includes(leg.kind)
    || !(leg.providerRouteId || leg.lineName) || !(leg.startID || leg.startName) || !(leg.endID || leg.endName))) return undefined;
  return JSON.stringify(rides.map(leg => [leg.kind, leg.providerRouteId || leg.lineName,
    leg.startID || leg.startName, leg.endID || leg.endName, leg.serviceClass, leg.directionCode]));
}

export function matchCurrentTransitEstimate(options: TransitRouteOption[], key: string, requested: Date) {
  const minute = Math.floor(requested.getTime() / 60_000);
  return options.find(option => option.provider === 'odsay' && option.source === 'api'
    && transitItineraryKey(option.transitLegs) === key && !option.transitLegs?.some(leg => leg.serviceAvailable === false)
    && Math.floor(Date.parse(option.providerDepartureAt ?? '') / 60_000) === minute
    && Date.parse(option.providerArrivalAt ?? '') > Date.parse(option.providerDepartureAt ?? ''));
}

/** Read-only estimate for this departure. The saved plan and alarm retain their own time basis. */
export function useCurrentTransitEstimate(scope: string | undefined, option?: RouteAlternativeOption | null,
  origin?: Place | null, destination?: Place | null) {
  const key = option?.provider === 'odsay' && option.mode === 'TRANSIT' && !option.intercityJourney
    ? transitItineraryKey(option.transitLegs) : undefined;
  const fromLat = origin?.lat, fromLng = origin?.lng, toLat = destination?.lat, toLng = destination?.lng;
  const requestKey = JSON.stringify([scope, key, fromLat, fromLng, toLat, toLng]);
  const [result, setResult] = useState<{ key: string; option: TransitRouteOption }>();
  useEffect(() => {
    setResult(undefined);
    if (!scope || !key || fromLat == null || fromLng == null || toLat == null || toLng == null
      || ![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return;
    const query = new AbortController();
    const requested = new Date();
    void getOdsayTransitRouteOptions({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, requested, query.signal)
      .then(options => {
        const match = matchCurrentTransitEstimate(options, key, requested);
        if (!query.signal.aborted && match) setResult({ key: requestKey, option: match });
      }).catch(() => { /* A missing estimate has no arrival clock to display. */ });
    return () => query.abort();
  }, [scope, key, requestKey, fromLat, fromLng, toLat, toLng]);
  return scope && result?.key === requestKey ? result.option : undefined;
}

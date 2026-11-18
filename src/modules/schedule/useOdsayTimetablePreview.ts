import { useEffect, useState } from 'react';
import {
  buildOdsayBusPreviewInput, buildOdsayTimetablePreviewInput, getOdsayBusPreview,
  getOdsayTimetablePreview, isFreshOdsayBusPreview,
} from '../../api/transitTimetablePreview';
import type { TransitBusPreview } from '../map/tmapApiCore';

export function useOdsayTimetablePreview(
  input: ReturnType<typeof buildOdsayTimetablePreviewInput>,
  busInput?: ReturnType<typeof buildOdsayBusPreviewInput>,
) {
  const [result, setResult] = useState<{
    input: NonNullable<typeof input>;
    timing: Awaited<ReturnType<typeof getOdsayTimetablePreview>>;
  }>();
  const [busResult, setBusResult] = useState<{ input: NonNullable<typeof busInput>; preview?: TransitBusPreview }>();

  useEffect(() => {
    if (!input) return;
    const request = new AbortController();
    const record = (timing: Awaited<ReturnType<typeof getOdsayTimetablePreview>>) => {
      if (!request.signal.aborted) setResult({ input, timing });
    };
    void getOdsayTimetablePreview(input, request.signal).then(record, () => record({}));
    return () => request.abort();
  }, [input]);

  useEffect(() => {
    if (!busInput) return;
    const request = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const record = (preview?: TransitBusPreview) => {
      if (request.signal.aborted) return;
      setBusResult({ input: busInput, preview });
      if (preview) {
        const expiryAt = Math.min(Date.parse(preview.departureAt), Date.parse(preview.sourceUpdatedAt) + 120_000);
        expiry = setTimeout(() => setBusResult({ input: busInput }), Math.max(0, expiryAt - Date.now()));
      }
    };
    void getOdsayBusPreview(busInput, request.signal).then(record, () => record());
    return () => {
      request.abort();
      if (expiry !== undefined) clearTimeout(expiry);
    };
  }, [busInput]);

  const busPreview = busResult?.input === busInput ? busResult?.preview : undefined;
  return {
    ...(result?.input === input ? result?.timing : undefined),
    busPreview: isFreshOdsayBusPreview(busPreview) ? busPreview : undefined,
    waiting: Boolean((input && result?.input !== input) || (busInput && busResult?.input !== busInput)),
  };
}

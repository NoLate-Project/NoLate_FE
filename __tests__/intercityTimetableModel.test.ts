import { isServiceDate, koreaServiceDate, serviceTime, timetableStatusMessage } from '../src/modules/schedule/intercityTimetableModel';

describe('intercity timetable presentation', () => {
  it('uses the Korea service date across UTC midnight', () => {
    expect(koreaServiceDate(new Date('2026-10-12T15:00:00Z'))).toBe('2026-10-13');
    expect(koreaServiceDate(new Date('2026-10-12T14:59:59Z'))).toBe('2026-10-12');
  });
  it('rejects impossible, unpadded and arbitrary dates', () => {
    for (const invalid of ['2026-02-30', '2026-13-01', '2026-1-01', '', 'next week']) expect(isServiceDate(invalid)).toBe(false);
    expect(isServiceDate('2028-02-29')).toBe(true);
  });
  it('keeps the provider wall time independent of the device timezone', () => {
    expect(serviceTime('2026-10-13T00:15+09:00')).toBe('00:15');
  });
  it('distinguishes no service, unsupported dates and quota exhaustion', () => {
    expect(timetableStatusMessage('NO_SERVICES')).toContain('제공된 운행편이 없습니다');
    expect(timetableStatusMessage('RATE_LIMITED')).toContain('한도');
    expect(timetableStatusMessage('DATE_UNSUPPORTED', '당일만 제공')).toBe('당일만 제공');
    expect(timetableStatusMessage('PROVIDER_UNAVAILABLE')).not.toEqual(timetableStatusMessage('NO_SERVICES'));
  });
});

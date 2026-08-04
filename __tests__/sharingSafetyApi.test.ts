import { apiDelete, apiGet, apiPost } from '../src/api/api';
import {
  blockSharingMember,
  createSharingReport,
  getBlockedSharingMembers,
  getMySharingReports,
  unblockSharingMember,
} from '../src/api/sharingSafety';
import { clearCalendarScheduleCache } from '../src/modules/schedule/calendarScheduleCache';

jest.mock('../src/api/api', () => ({
  apiDelete: jest.fn(),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

jest.mock('../src/modules/schedule/calendarScheduleCache', () => ({
  clearCalendarScheduleCache: jest.fn(),
}));

const mockedApiDelete = jest.mocked(apiDelete);
const mockedApiGet = jest.mocked(apiGet);
const mockedApiPost = jest.mocked(apiPost);
const mockedClearCalendarScheduleCache = jest.mocked(clearCalendarScheduleCache);

describe('sharing safety api', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('submits and lists reports through protected sharing-safety endpoints', async () => {
    const report = {
      id: 8,
      reportedMemberId: 22,
      resourceType: 'SCHEDULE' as const,
      resourceId: 41,
      reason: 'UNWANTED_SHARING' as const,
      status: 'SUBMITTED' as const,
    };
    mockedApiPost.mockResolvedValueOnce({ success: true, data: report });
    mockedApiGet.mockResolvedValueOnce({ success: true, data: [report] });

    await expect(
      createSharingReport({
        reportedMemberId: 22,
        resourceType: 'SCHEDULE',
        resourceId: 41,
        reason: 'UNWANTED_SHARING',
      }),
    ).resolves.toEqual(report);
    await expect(getMySharingReports()).resolves.toEqual([report]);

    expect(mockedApiPost).toHaveBeenCalledWith('/api/sharing-safety/reports', {
      reportedMemberId: 22,
      resourceType: 'SCHEDULE',
      resourceId: 41,
      reason: 'UNWANTED_SHARING',
    });
    expect(mockedApiGet).toHaveBeenCalledWith('/api/sharing-safety/reports');
    expect(mockedClearCalendarScheduleCache).not.toHaveBeenCalled();
  });

  test('block and unblock both invalidate local schedule visibility cache', async () => {
    const blocked = { memberId: 22, name: '차단 사용자', email: 'blocked@example.com' };
    mockedApiPost.mockResolvedValueOnce({ success: true, data: blocked });
    mockedApiDelete.mockResolvedValueOnce({ success: true });
    mockedApiGet.mockResolvedValueOnce({ success: true, data: [blocked] });

    await expect(blockSharingMember(22)).resolves.toEqual(blocked);
    await expect(unblockSharingMember(22)).resolves.toBeUndefined();
    await expect(getBlockedSharingMembers()).resolves.toEqual([blocked]);

    expect(mockedApiPost).toHaveBeenCalledWith('/api/sharing-safety/blocks/22');
    expect(mockedApiDelete).toHaveBeenCalledWith('/api/sharing-safety/blocks/22');
    expect(mockedApiGet).toHaveBeenCalledWith('/api/sharing-safety/blocks');
    expect(mockedClearCalendarScheduleCache).toHaveBeenCalledTimes(2);
  });
});

import { apiDelete, apiGet, apiPost } from './api';
import { clearCalendarScheduleCache } from '../modules/schedule/calendarScheduleCache';
import {
  assertApiSuccess,
  type ApiEnvelope,
  unwrapApiResponse,
} from './response';
import type { ShareResourceType } from './scheduleSharing';

export type SharingReportReason =
  | 'UNWANTED_SHARING'
  | 'HARASSMENT'
  | 'SPAM'
  | 'INAPPROPRIATE_CONTENT'
  | 'PRIVACY_CONCERN'
  | 'OTHER';

export type SharingReportStatus =
  | 'SUBMITTED'
  | 'REVIEWING'
  | 'RESOLVED'
  | 'DISMISSED';

export type SharingReport = {
  id: number;
  reportedMemberId: number;
  resourceType: ShareResourceType;
  resourceId: number;
  reason: SharingReportReason;
  details?: string | null;
  status: SharingReportStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
  resolvedAt?: string | null;
};

export type BlockedSharingMember = {
  memberId: number;
  name?: string | null;
  email?: string | null;
  blockedAt?: string | null;
};

export async function createSharingReport(payload: {
  reportedMemberId: number;
  resourceType: ShareResourceType;
  resourceId: number;
  reason: SharingReportReason;
  details?: string;
}): Promise<SharingReport> {
  const response = await apiPost<ApiEnvelope<SharingReport>, typeof payload>(
    '/api/sharing-safety/reports',
    payload,
  );
  return unwrapApiResponse(response);
}

export async function getMySharingReports(): Promise<SharingReport[]> {
  const response = await apiGet<ApiEnvelope<SharingReport[]>>(
    '/api/sharing-safety/reports',
  );
  return unwrapApiResponse(response);
}

export async function blockSharingMember(
  targetMemberId: number,
): Promise<BlockedSharingMember> {
  const response = await apiPost<ApiEnvelope<BlockedSharingMember>>(
    `/api/sharing-safety/blocks/${targetMemberId}`,
  );
  const blocked = unwrapApiResponse(response);
  clearCalendarScheduleCache();
  return blocked;
}

export async function unblockSharingMember(targetMemberId: number): Promise<void> {
  const response = await apiDelete<ApiEnvelope<unknown>>(
    `/api/sharing-safety/blocks/${targetMemberId}`,
  );
  assertApiSuccess(response);
  clearCalendarScheduleCache();
}

export async function getBlockedSharingMembers(): Promise<BlockedSharingMember[]> {
  const response = await apiGet<ApiEnvelope<BlockedSharingMember[]>>(
    '/api/sharing-safety/blocks',
  );
  return unwrapApiResponse(response);
}

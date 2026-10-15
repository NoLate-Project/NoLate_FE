import type { IntercityKind, IntercityService } from '../../api/intercityTimetable';

/** User-reviewed travel information, never carrier verification or a boarding credential. */
export type ImportedTicket = {
    version: 1; id: string; kind: IntercityKind;
    source: 'IOS_SHARE_TEXT' | 'IOS_SHARE_IMAGE' | 'IOS_SHARE_PDF';
    verification: 'USER_CONFIRMED'; bookingStatus: 'UNVERIFIED';
    departureName: string; arrivalName: string; departureAt: string; arrivalAt: string;
    trainNumber?: string; grade?: string; confirmedAt: string;
};
// Backward-compatible name for callers that already store train tickets.
export type ImportedTrainTicket = ImportedTicket;
export type TicketRideService = Omit<IntercityService, 'timingBasis' | 'bookingStatus'> & {
    timingBasis: 'TICKET'; bookingStatus: 'UNVERIFIED';
};
export type IntercityRideService = IntercityService | TicketRideService;

export function getImportedTicket(route: unknown): ImportedTrainTicket | undefined {
    if (!route || typeof route !== 'object') return undefined;
    const ticket = (route as { importedTicket?: ImportedTrainTicket }).importedTicket;
    if (!ticket || ticket.version !== 1 || !['TRAIN', 'EXPRESS_BUS', 'INTERCITY_BUS'].includes(ticket.kind) || !/^ticket:[0-9a-f-]{36}$/i.test(ticket.id) ||
        !['IOS_SHARE_TEXT', 'IOS_SHARE_IMAGE', 'IOS_SHARE_PDF'].includes(ticket.source) || ticket.verification !== 'USER_CONFIRMED' || ticket.bookingStatus !== 'UNVERIFIED' ||
        ![ticket.departureName, ticket.arrivalName].every(name => typeof name === 'string' && name.trim().length > 0 && name.length <= 60) ||
        ticket.departureName.trim() === ticket.arrivalName.trim() || (ticket.kind === 'TRAIN' ? !/^\d{1,6}$/.test(ticket.trainNumber ?? '') : !!ticket.trainNumber || typeof ticket.grade !== 'string' || !ticket.grade.trim() || ticket.grade.length > 40) ||
        ![ticket.departureAt, ticket.arrivalAt].every(time => typeof time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(time) && Number.isFinite(Date.parse(time)) && new Date(Date.parse(time) + 9 * 3600000).toISOString().slice(0, 19) + '+09:00' === time) ||
        Date.parse(ticket.arrivalAt) <= Date.parse(ticket.departureAt) || Date.parse(ticket.arrivalAt) - Date.parse(ticket.departureAt) > 86400000 ||
        !Number.isFinite(Date.parse(ticket.confirmedAt))) return undefined;
    return ticket;
}

export function ticketRideService(ticket: ImportedTrainTicket): TicketRideService {
    if (!getImportedTicket({ importedTicket: ticket })) throw new Error('승차권 정보를 다시 확인해 주세요.');
    return {
        id: ticket.id, kind: ticket.kind, departureId: `${ticket.id}:departure`, arrivalId: `${ticket.id}:arrival`,
        departureName: ticket.departureName, arrivalName: ticket.arrivalName, departureAt: ticket.departureAt, arrivalAt: ticket.arrivalAt,
        serviceDate: ticket.departureAt.slice(0, 10), trainNumber: ticket.trainNumber, grade: ticket.grade,
        timingBasis: 'TICKET', bookingStatus: 'UNVERIFIED',
    };
}

export function assertTicketService(ticket: ImportedTrainTicket, service?: IntercityRideService): void {
    const expected = ticketRideService(ticket);
    if (!service || Object.keys(expected).some(key => expected[key as keyof TicketRideService] !== service[key as keyof IntercityRideService])) {
        throw new Error('가져온 승차권의 운행편을 선택해 연결해 주세요. 다른 편은 승차권 시각을 바꿀 수 없습니다.');
    }
}

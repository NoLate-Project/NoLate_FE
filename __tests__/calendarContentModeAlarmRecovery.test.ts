const mockUpdateScheduleCalendar = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();

jest.mock("../src/api/scheduleCalendars", () => ({
    updateScheduleCalendar: (...args: unknown[]) =>
        mockUpdateScheduleCalendar(...args),
}));

jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));

import type { ScheduleCalendar } from "../src/api/scheduleCalendars";
import { updateCalendarContentModeWithAlarmRecovery } from "../src/modules/share/calendarContentModeAlarmRecovery";
import type { ScheduleShareContentMode } from "../src/modules/schedule/types";

const calendar: ScheduleCalendar = {
    id: 7,
    title: "가족",
    color: "#2F80FF",
    defaultContentMode: "SCHEDULE_ONLY",
    status: "ACTIVE",
    ownerMemberId: 1,
    myRole: "OWNER",
    memberCount: 2,
    routeReminderEnabled: true,
};

describe("share inbox calendar content-mode alarm recovery", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdateScheduleCalendar.mockResolvedValue(calendar);
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
    });

    it("recovers exactly once after travel access is downgraded", async () => {
        await expect(updateCalendarContentModeWithAlarmRecovery(
            "7",
            "SCHEDULE_AND_TRAVEL",
            "SCHEDULE_ONLY",
        )).resolves.toBe(calendar);

        expect(mockUpdateScheduleCalendar).toHaveBeenCalledWith("7", {
            defaultContentMode: "SCHEDULE_ONLY",
        });
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockUpdateScheduleCalendar.mock.invocationCallOrder[0])
            .toBeLessThan(
                mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0],
            );
    });

    it("does not recover when a downgrade mutation fails", async () => {
        const mutationError = new Error("mode failed");
        mockUpdateScheduleCalendar.mockRejectedValue(mutationError);

        await expect(updateCalendarContentModeWithAlarmRecovery(
            "7",
            "SCHEDULE_AND_TRAVEL",
            "SCHEDULE_ONLY",
        )).rejects.toBe(mutationError);

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });

    it("does not recover after an upgrade", async () => {
        await updateCalendarContentModeWithAlarmRecovery(
            7,
            "SCHEDULE_ONLY",
            "SCHEDULE_AND_TRAVEL",
        );

        expect(mockUpdateScheduleCalendar).toHaveBeenCalledWith(7, {
            defaultContentMode: "SCHEDULE_AND_TRAVEL",
        });
        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });

    it.each([
        ["SCHEDULE_ONLY", "SCHEDULE_ONLY"],
        ["SCHEDULE_AND_TRAVEL", "SCHEDULE_AND_TRAVEL"],
        [undefined, "SCHEDULE_ONLY"],
    ] as const)(
        "does not recover for a non-downgrade transition from %s to %s",
        async (
            previousMode: ScheduleShareContentMode | undefined,
            nextMode: ScheduleShareContentMode,
        ) => {
            await updateCalendarContentModeWithAlarmRecovery(
                7,
                previousMode,
                nextMode,
            );

            expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        },
    );
});

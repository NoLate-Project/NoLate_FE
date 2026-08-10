const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const addFormSource = readFileSync(
    "src/modules/schedule/components/form/ScheduleAddModal.tsx",
    "utf8",
);
const editFormSource = readFileSync(
    "src/modules/schedule/screens/ScheduleEditScreen.tsx",
    "utf8",
);

describe("schedule form calendar simplicity", () => {
    test("new schedules start as private without a storage selector", () => {
        expect(addFormSource).not.toContain("ScheduleCalendarSelectBox");
        expect(addFormSource).not.toContain("getScheduleCalendars");
        expect(addFormSource).not.toContain("onManageCalendars");
        expect(addFormSource).toContain("calendarId: null");
        expect(addFormSource).toContain("calendarContentModeOverride: null");
    });

    test("editing lets only the original author move an event while keeping categories scoped", () => {
        expect(editFormSource).toContain("ScheduleCalendarSelectBox");
        expect(editFormSource).toContain("getScheduleCalendars");
        expect(editFormSource).toContain("isCategoryInCalendarScope");
        expect(editFormSource).toContain("locked={!canChangeCalendar}");
        expect(editFormSource).toContain("canChangeCalendar ? calendarId : item.calendarId ?? null");
        expect(editFormSource).toContain(
            "calendarContentModeOverride: item.calendarContentModeOverride ?? null",
        );
    });
});

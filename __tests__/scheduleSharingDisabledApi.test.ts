import {
    apiDelete,
    apiGet,
    apiPatch,
    apiPost,
    apiPut,
} from "../src/api/api";
import {
    addScheduleCalendarMember,
    archiveScheduleCalendar,
    createScheduleCalendar,
    getScheduleCalendarMembers,
    getScheduleCalendars,
    leaveScheduleCalendar,
    removeScheduleCalendarMember,
    transferScheduleCalendarOwnership,
    updateMyScheduleCalendarPreferences,
    updateScheduleCalendar,
    updateScheduleCalendarMember,
} from "../src/api/scheduleCalendars";
import {
    acceptShareInvitation,
    createCalendarShare,
    createCalendarShareInvitation,
    createCategoryShare,
    createCategoryShareInvitation,
    createScheduleShare,
    createScheduleShareInvitation,
    getCalendarShareInvitations,
    getCategoryShareInvitations,
    getScheduleShareInvitations,
    getShareInbox,
    getShareOutbox,
    revokeCalendarShareInvitation,
    revokeCategoryShare,
    revokeCategoryShareInvitation,
    revokeScheduleShare,
    revokeScheduleShareInvitation,
} from "../src/api/scheduleSharing";
import { ScheduleSharingDisabledError } from "../src/modules/share/scheduleSharingPolicy";
import {
    getScheduleTravelPlan,
    getScheduleTravelPlanOverview,
} from "../src/api/scheduleTravelPlans";

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

jest.mock("../src/api/api", () => ({
    apiDelete: jest.fn(),
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
    apiPut: jest.fn(),
}));

const networkMocks = [
    jest.mocked(apiDelete),
    jest.mocked(apiGet),
    jest.mocked(apiPatch),
    jest.mocked(apiPost),
    jest.mocked(apiPut),
];

describe("schedule sharing disabled API boundary", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test.each([
        ["getShareInbox", () => getShareInbox()],
        ["getShareOutbox", () => getShareOutbox()],
        ["createScheduleShare", () => createScheduleShare("1", {})],
        ["createCategoryShare", () => createCategoryShare("2", {})],
        ["createCalendarShare", () => createCalendarShare("3", {})],
        ["revokeScheduleShare", () => revokeScheduleShare("1", "11")],
        ["revokeCategoryShare", () => revokeCategoryShare("2", "12")],
        ["getScheduleShareInvitations", () => getScheduleShareInvitations("1")],
        ["createScheduleShareInvitation", () =>
            createScheduleShareInvitation("1", {})],
        ["getCategoryShareInvitations", () => getCategoryShareInvitations("2")],
        ["createCategoryShareInvitation", () =>
            createCategoryShareInvitation("2", {})],
        ["getCalendarShareInvitations", () => getCalendarShareInvitations("3")],
        ["createCalendarShareInvitation", () =>
            createCalendarShareInvitation("3", {})],
        ["revokeScheduleShareInvitation", () =>
            revokeScheduleShareInvitation("1", "21")],
        ["revokeCategoryShareInvitation", () =>
            revokeCategoryShareInvitation("2", "22")],
        ["revokeCalendarShareInvitation", () =>
            revokeCalendarShareInvitation("3", "23")],
        ["acceptShareInvitation", () => acceptShareInvitation("valid-token-value")],
    ])("%s rejects before a network call", async (_name, request) => {
        await expect(request()).rejects.toBeInstanceOf(
            ScheduleSharingDisabledError,
        );
        networkMocks.forEach((networkMock) => {
            expect(networkMock).not.toHaveBeenCalled();
        });
    });

    test.each([
        ["getScheduleCalendars", () => getScheduleCalendars()],
        ["createScheduleCalendar", () => createScheduleCalendar({
            title: "팀",
            color: "#2563EB",
            defaultContentMode: "SCHEDULE_ONLY",
        })],
        ["updateScheduleCalendar", () =>
            updateScheduleCalendar("3", { title: "변경" })],
        ["archiveScheduleCalendar", () => archiveScheduleCalendar("3")],
        ["getScheduleCalendarMembers", () => getScheduleCalendarMembers("3")],
        ["addScheduleCalendarMember", () => addScheduleCalendarMember("3", {
            targetAppId: 9,
            role: "VIEWER",
        })],
        ["updateScheduleCalendarMember", () =>
            updateScheduleCalendarMember("3", 9, { role: "EDITOR" })],
        ["updateMyScheduleCalendarPreferences", () =>
            updateMyScheduleCalendarPreferences("3", true)],
        ["removeScheduleCalendarMember", () =>
            removeScheduleCalendarMember("3", 9)],
        ["leaveScheduleCalendar", () => leaveScheduleCalendar("3")],
        ["transferScheduleCalendarOwnership", () =>
            transferScheduleCalendarOwnership("3", 9)],
        ["getScheduleTravelPlanOverview", () =>
            getScheduleTravelPlanOverview("1")],
        ["getScheduleTravelPlan", () =>
            getScheduleTravelPlan("1", 9)],
    ])("%s rejects before a network call", async (_name, request) => {
        await expect(request()).rejects.toBeInstanceOf(
            ScheduleSharingDisabledError,
        );
        networkMocks.forEach((networkMock) => {
            expect(networkMock).not.toHaveBeenCalled();
        });
    });
});

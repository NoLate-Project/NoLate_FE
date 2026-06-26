import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../src/api/api";
import {
    changePassword,
    getMyProfile,
    logoutMember,
    refreshMemberToken,
    updateMyProfile,
    withdrawMember,
} from "../src/api/member";
import {
    getCalendarSchedules,
    getDailySchedules,
    getDepartureReadySchedules,
    getUpcomingSchedules,
    markScheduleDeparted,
    searchSchedules,
} from "../src/api/schedule";
import {
    createScheduleCategoryToApi,
    deleteScheduleCategoryFromApi,
    getScheduleCategoriesFromApi,
    updateScheduleCategoryToApi,
} from "../src/api/scheduleCategories";

jest.mock("../src/api/api", () => ({
    apiDelete: jest.fn(),
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
    apiPut: jest.fn(),
}));

const mockedApiDelete = jest.mocked(apiDelete);
const mockedApiGet = jest.mocked(apiGet);
const mockedApiPatch = jest.mocked(apiPatch);
const mockedApiPost = jest.mocked(apiPost);
const mockedApiPut = jest.mocked(apiPut);

describe("member api wrappers", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("refreshMemberToken calls refresh endpoint", async () => {
        mockedApiPost.mockResolvedValue({
            success: true,
            data: { id: 1, accessToken: "access", refreshToken: "refresh" },
        });

        const result = await refreshMemberToken({ refreshToken: "old-refresh" });

        expect(result.accessToken).toBe("access");
        expect(mockedApiPost).toHaveBeenCalledWith("/api/member/auth/refresh", { refreshToken: "old-refresh" });
    });

    test("logoutMember accepts empty success envelope", async () => {
        mockedApiPost.mockResolvedValue({ success: true });

        await logoutMember({ refreshToken: "refresh" });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/member/auth/logout", { refreshToken: "refresh" });
    });

    test("profile wrappers use authenticated profile endpoints", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: { memberId: 1, nickname: "tester" },
        });
        mockedApiPut.mockResolvedValue({
            success: true,
            data: { memberId: 1, nickname: "updated" },
        });

        await expect(getMyProfile()).resolves.toMatchObject({ memberId: 1 });
        await expect(updateMyProfile({ nickname: "updated" })).resolves.toMatchObject({ nickname: "updated" });

        expect(mockedApiGet).toHaveBeenCalledWith("/api/member/profile");
        expect(mockedApiPut).toHaveBeenCalledWith("/api/member/profile", { nickname: "updated" });
    });

    test("password and withdraw wrappers use protected endpoints", async () => {
        mockedApiPatch.mockResolvedValue({ success: true });
        mockedApiDelete.mockResolvedValue({ success: true });

        await changePassword({ currentPassword: "old-password", newPassword: "new-password" });
        await withdrawMember({ password: "password" });

        expect(mockedApiPatch).toHaveBeenCalledWith("/api/member/password", {
            currentPassword: "old-password",
            newPassword: "new-password",
        });
        expect(mockedApiDelete).toHaveBeenCalledWith("/api/member/withdraw", { data: { password: "password" } });
    });
});

describe("schedule query api wrappers", () => {
    const scheduleDto = {
        id: 10,
        title: "Team sync",
        startAt: "2026-07-01T01:00:00Z",
        category: { id: "1", title: "Work", color: "#f44336" },
    };

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("calendar daily upcoming search and departure endpoints normalize ids", async () => {
        mockedApiGet.mockResolvedValue({ success: true, data: [scheduleDto] });

        await expect(getCalendarSchedules("2026-07-01T00:00:00Z", "2026-07-31T23:59:59Z")).resolves.toMatchObject([
            { id: "10" },
        ]);
        await expect(getDailySchedules("2026-07-01")).resolves.toMatchObject([{ id: "10" }]);
        await expect(getUpcomingSchedules("2026-07-01T00:00:00Z", 5)).resolves.toMatchObject([{ id: "10" }]);
        await expect(searchSchedules({ keyword: "sync" })).resolves.toMatchObject([{ id: "10" }]);
        await expect(getDepartureReadySchedules()).resolves.toMatchObject([{ id: "10" }]);

        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/calendar", {
            params: { startAt: "2026-07-01T00:00:00Z", endAt: "2026-07-31T23:59:59Z" },
        });
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/daily", { params: { date: "2026-07-01" } });
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/upcoming", {
            params: { fromAt: "2026-07-01T00:00:00Z", limit: 5 },
        });
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/search", { params: { keyword: "sync" } });
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/departures", {
            params: { fromAt: undefined, toAt: undefined },
        });
    });

    test("markScheduleDeparted posts depart-now action and normalizes response id", async () => {
        mockedApiPost.mockResolvedValue({ success: true, data: scheduleDto });

        await expect(markScheduleDeparted("10")).resolves.toMatchObject({ id: "10" });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedules/10/depart-now");
    });
});

describe("schedule category api wrappers", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("list wrapper normalizes ids and fallback category fields", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: [
                { id: 1, title: " 업무 ", color: " #ff3333 ", iconKey: " briefcase ", sortOrder: 0 },
                { id: null, title: "ignored", color: "#000000" },
                { id: 2, title: "", color: "", iconKey: "", sortOrder: null },
            ],
        });

        await expect(getScheduleCategoriesFromApi()).resolves.toEqual([
            { id: "1", title: "업무", color: "#ff3333", iconKey: "briefcase", sortOrder: 0, updatedAt: undefined },
            { id: "2", title: "카테고리", color: "#5A96FF", iconKey: undefined, sortOrder: undefined, updatedAt: undefined },
        ]);

        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedule-categories");
    });

    test("create and update wrappers call category endpoints with trimmed payloads", async () => {
        mockedApiPost.mockResolvedValue({
            success: true,
            data: { id: 3, title: "운동", color: "#30D158", iconKey: "sparkles", sortOrder: 3 },
        });
        mockedApiPatch.mockResolvedValue({
            success: true,
            data: { id: 3, title: "운동 수정", color: "#0A84FF", iconKey: "sparkles", sortOrder: 1 },
        });

        await expect(createScheduleCategoryToApi(" 운동 ", "#30D158", " sparkles ")).resolves.toMatchObject({
            id: "3",
            title: "운동",
        });
        await expect(updateScheduleCategoryToApi("3", { title: "운동 수정", sortOrder: 1 })).resolves.toMatchObject({
            id: "3",
            title: "운동 수정",
            sortOrder: 1,
        });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedule-categories", {
            title: "운동",
            color: "#30D158",
            iconKey: "sparkles",
        });
        expect(mockedApiPatch).toHaveBeenCalledWith("/api/schedule-categories/3", {
            title: "운동 수정",
            sortOrder: 1,
        });
    });

    test("delete wrapper accepts an empty success envelope", async () => {
        mockedApiDelete.mockResolvedValue({ success: true });

        await expect(deleteScheduleCategoryFromApi("3")).resolves.toBeUndefined();

        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedule-categories/3");
    });
});

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../src/api/api";
import {
    changePassword,
    completeMemberCuration,
    getSnsRegistrationStatus,
    getMemberCurationStatus,
    getMyProfile,
    logoutMember,
    refreshMemberToken,
    signUpMember,
    snsSignUpMember,
    updateMyProfile,
    withdrawMember,
} from "../src/api/member";
import { getSignupConsentPolicy } from "../src/api/legal";
import {
    getCalendarSchedules,
    getDailySchedules,
    getDepartureReadySchedules,
    getScheduleDepartureStatus,
    getUpcomingSchedules,
    importCalendarSchedule,
    markScheduleDeparted,
    searchSchedules,
    sendScheduleDepartureNudge,
    snoozeScheduleDepartureReminder,
} from "../src/api/schedule";
import {
    createScheduleCategoryToApi,
    deleteScheduleCategoryFromApi,
    getScheduleCategoriesFromApi,
    updateScheduleCategoryToApi,
} from "../src/api/scheduleCategories";
import {
    clearDefaultOriginFromApi,
    getDefaultOriginFromApi,
    saveDefaultOriginToApi,
} from "../src/api/favoritePlaces";
import {
    acceptShareInvitation,
    createCalendarShare,
    createCalendarShareInvitation,
    createCategoryShareInvitation,
    createCategoryShare,
    createScheduleShareInvitation,
    createScheduleShare,
    getShareInbox,
    getShareOutbox,
    getCategoryShareInvitations,
    getCalendarShareInvitations,
    getScheduleShareInvitations,
    revokeCategoryShare,
    revokeCategoryShareInvitation,
    revokeCalendarShareInvitation,
    revokeScheduleShare,
    revokeScheduleShareInvitation,
} from "../src/api/scheduleSharing";
import {
    archiveScheduleCalendar,
    createScheduleCalendar,
    getScheduleCalendarMembers,
    getScheduleCalendars,
    updateMyScheduleCalendarPreferences,
    updateScheduleCalendar,
} from "../src/api/scheduleCalendars";

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

    test("curation wrappers use authenticated status and completion endpoints", async () => {
        mockedApiGet.mockResolvedValue({ success: true, data: { curationCompleted: false } });
        mockedApiPatch.mockResolvedValue({ success: true, data: { curationCompleted: true } });

        await expect(getMemberCurationStatus()).resolves.toEqual({ curationCompleted: false });
        await expect(completeMemberCuration()).resolves.toEqual({ curationCompleted: true });

        expect(mockedApiGet).toHaveBeenCalledWith("/api/member/curation", { timeout: 3_500 });
        expect(mockedApiPatch).toHaveBeenCalledWith("/api/member/curation/complete");
    });

    test("signup wrappers send versioned consent for common and new social accounts", async () => {
        const consents = {
            termsVersion: "2026.07.16",
            privacyCollectionVersion: "2026.07.16",
            termsAgreed: true,
            privacyCollectionAgreed: true,
        };
        mockedApiPost
            .mockResolvedValueOnce({ success: true, data: { id: 2 } })
            .mockResolvedValueOnce({ success: true, data: { registered: false } })
            .mockResolvedValueOnce({ success: true, data: { id: 3, isNewMember: true } });

        await signUpMember({ name: "user", email: "user@test.com", password: "password1!", consents });
        await expect(getSnsRegistrationStatus({ loginType: "KAKAO", providerToken: "kakao-proof" }))
            .resolves.toEqual({ registered: false });
        await snsSignUpMember({
            loginType: "KAKAO",
            providerToken: "kakao-proof",
            consents,
        });

        expect(mockedApiPost).toHaveBeenNthCalledWith(1, "/api/member/auth/sign-up", {
            name: "user",
            email: "user@test.com",
            password: "password1!",
            consents,
        });
        expect(mockedApiPost).toHaveBeenNthCalledWith(2, "/api/member/auth/sns-registration", {
            loginType: "KAKAO",
            providerToken: "kakao-proof",
        });
        expect(mockedApiPost).toHaveBeenNthCalledWith(3, "/api/member/auth/sns-sign-up", {
            loginType: "KAKAO",
            providerToken: "kakao-proof",
            consents,
        });
    });

    test("signup consent policy comes from the public legal endpoint", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: {
                terms: { type: "TERMS_OF_SERVICE", version: "v1" },
                privacyCollection: { type: "PRIVACY_COLLECTION_CONSENT", version: "v2" },
            },
        });

        await expect(getSignupConsentPolicy()).resolves.toMatchObject({
            terms: { version: "v1" },
            privacyCollection: { version: "v2" },
        });
        expect(mockedApiGet).toHaveBeenCalledWith("/api/legal/signup-consents");
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
        await withdrawMember(
            { password: "password" },
            { accessToken: "A-access-snapshot" },
        );

        expect(mockedApiPatch).toHaveBeenCalledWith("/api/member/password", {
            currentPassword: "old-password",
            newPassword: "new-password",
        });
        expect(mockedApiDelete).toHaveBeenCalledWith("/api/member/withdraw", {
            data: { password: "password" },
            _allowDuringAccountExit: true,
            headers: {
                Authorization: "Bearer A-access-snapshot",
            },
        });
    });

    test("withdrawal without the account-exit access snapshot fails before API mutation", async () => {
        await expect(withdrawMember(
            { password: "password" },
            { accessToken: null },
        )).rejects.toThrow("인증 snapshot");
        expect(mockedApiDelete).not.toHaveBeenCalled();
    });

    test("account-exit withdrawal keeps the snapshotted A Authorization after local clear", async () => {
        mockedApiDelete.mockResolvedValue({ success: true });

        await withdrawMember(
            { password: "password" },
            { accessToken: "A-access-snapshot" },
        );

        expect(mockedApiDelete).toHaveBeenCalledWith("/api/member/withdraw", {
            data: { password: "password" },
            _allowDuringAccountExit: true,
            headers: {
                Authorization: "Bearer A-access-snapshot",
            },
        });
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

    test("departure status keeps nullable rollout fields and normalizes enums safely", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: {
                scheduleId: 42,
                travelMinutes: 37,
                recommendedDepartureAt: "2026-07-24T09:20:00+09:00",
                evaluatedAt: null,
                liveFetchedAt: "2026-07-24T08:58:00+09:00",
                source: "LIVE_PROVIDER",
                stale: null,
                confidence: "HIGH",
                failureReason: null,
                lastTrafficChangeMinutes: -4,
                lastChangedAt: null,
                nextCheckAt: null,
                preparationMinutes: null,
                preparationStartAt: null,
                safetyBufferMinutes: 5,
                timeZone: "Asia/Seoul",
            },
        });

        await expect(getScheduleDepartureStatus("42")).resolves.toEqual({
            scheduleId: "42",
            travelMinutes: 37,
            recommendedDepartureAt: "2026-07-24T09:20:00+09:00",
            evaluatedAt: null,
            liveFetchedAt: "2026-07-24T08:58:00+09:00",
            source: "LIVE_PROVIDER",
            stale: null,
            confidence: "HIGH",
            failureReason: null,
            lastTrafficChangeMinutes: -4,
            lastChangedAt: null,
            nextCheckAt: null,
            preparationMinutes: null,
            preparationStartAt: null,
            safetyBufferMinutes: 5,
            timeZone: "Asia/Seoul",
        });
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/42/departure-status");

        mockedApiGet.mockResolvedValue({
            success: true,
            data: {
                source: "UNKNOWN_FUTURE_SOURCE",
                confidence: "VERY_HIGH",
            },
        });

        await expect(getScheduleDepartureStatus("43")).resolves.toMatchObject({
            scheduleId: "43",
            source: null,
            confidence: null,
            travelMinutes: null,
            stale: null,
        });
    });

    test("departure status rejects a response for another schedule", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: {
                scheduleId: 99,
                travelMinutes: 12,
                stale: false,
            },
        });

        await expect(getScheduleDepartureStatus("42")).rejects.toMatchObject({
            name: "ApiResponseError",
            errorCode: "DEPARTURE_STATUS_SCHEDULE_MISMATCH",
        });
    });

    test("markScheduleDeparted posts depart-now action and normalizes response id", async () => {
        mockedApiPost.mockResolvedValue({ success: true, data: scheduleDto });

        await expect(markScheduleDeparted("10")).resolves.toMatchObject({
            item: { id: "10" },
            refreshing: true,
        });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedules/10/depart-now");
    });

    test("depart/snooze response의 authoritative status를 파싱한다", async () => {
        mockedApiPost
            .mockResolvedValueOnce({
                success: true,
                data: {
                    schedule: scheduleDto,
                    departureStatus: {
                        scheduleId: 10,
                        travelMinutes: 25,
                        nextCheckAt: "2026-07-24T09:10:00+09:00",
                        stale: false,
                    },
                },
            })
            .mockResolvedValueOnce({
                success: true,
                data: {
                    status: {
                        scheduleId: 10,
                        travelMinutes: 25,
                        nextCheckAt: "2026-07-24T09:20:00+09:00",
                        stale: false,
                    },
                },
            });

        await expect(markScheduleDeparted("10")).resolves.toMatchObject({
            item: { id: "10" },
            status: { scheduleId: "10", nextCheckAt: "2026-07-24T09:10:00+09:00" },
            refreshing: false,
        });
        await expect(snoozeScheduleDepartureReminder("10")).resolves.toMatchObject({
            status: { scheduleId: "10", nextCheckAt: "2026-07-24T09:20:00+09:00" },
            refreshing: false,
        });
    });

    test("notification action idempotency key를 action API에 전달한다", async () => {
        const hashLogicalEventKey = `key:${"b".repeat(64)}`;
        const uuidLogicalEventKey =
            "event:6ba7b810-9dad-41d1-80b4-00c04fd430c8";
        mockedApiPost
            .mockResolvedValueOnce({ success: true, data: scheduleDto })
            .mockResolvedValueOnce({
                success: true,
                data: {
                    status: {
                        scheduleId: 10,
                        stale: true,
                    },
                },
            });

        await markScheduleDeparted("10", {
            idempotencyKey: `departNow:${hashLogicalEventKey}`,
        });
        await snoozeScheduleDepartureReminder("10", {
            idempotencyKey: `snooze:${uuidLogicalEventKey}`,
        });

        expect(mockedApiPost).toHaveBeenNthCalledWith(
            1,
            "/api/schedules/10/depart-now",
            undefined,
            {
                signal: undefined,
                headers: {
                    "Idempotency-Key": `departNow:${hashLogicalEventKey}`,
                },
            },
        );
        expect(mockedApiPost).toHaveBeenNthCalledWith(
            2,
            "/api/schedules/10/departure-reminder/snooze",
            undefined,
            {
                signal: undefined,
                headers: {
                    "Idempotency-Key": `snooze:${uuidLogicalEventKey}`,
                },
            },
        );
        expect(mockedApiPost.mock.calls[0][2]?.headers).not.toEqual(
            expect.objectContaining({
                "Idempotency-Key": expect.stringContaining(":logical:"),
            }),
        );
        expect(mockedApiPost.mock.calls[1][2]?.headers).not.toEqual(
            expect.objectContaining({
                "Idempotency-Key": expect.stringContaining(":logical:"),
            }),
        );
    });

    test.each([
        {
            label: "depart item",
            call: () => markScheduleDeparted("10"),
            response: {
                success: true,
                data: { ...scheduleDto, id: 11 },
            },
            errorCode: "DEPARTURE_MUTATION_SCHEDULE_MISMATCH",
        },
        {
            label: "depart status",
            call: () => markScheduleDeparted("10"),
            response: {
                success: true,
                data: {
                    schedule: scheduleDto,
                    departureStatus: { scheduleId: 11, stale: true },
                },
            },
            errorCode: "DEPARTURE_MUTATION_STATUS_MISMATCH",
        },
        {
            label: "snooze status missing id",
            call: () => snoozeScheduleDepartureReminder("10"),
            response: {
                success: true,
                data: { status: { stale: true } },
            },
            errorCode: "DEPARTURE_MUTATION_STATUS_MISMATCH",
        },
    ])(
        "$label mismatch는 authoritative cache/store 반영 전에 거부한다",
        async ({ call, response, errorCode }) => {
            mockedApiPost.mockResolvedValue(response);
            await expect(call()).rejects.toMatchObject({ errorCode });
        },
    );

    test("sendScheduleDepartureNudge targets one shared participant and returns token result", async () => {
        mockedApiPost.mockResolvedValue({
            success: true,
            data: { requestedCount: 1, sentCount: 1, failedCount: 0, removedTokenCount: 0 },
        });

        await expect(sendScheduleDepartureNudge("10", 2)).resolves.toEqual({
            requestedCount: 1,
            sentCount: 1,
            failedCount: 0,
            removedTokenCount: 0,
        });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedules/10/departure-nudges/2");
    });

    test("calendar import posts the external occurrence identity and returns created state", async () => {
        const payload = {
            title: "Team sync",
            startAt: "2026-07-01T01:00:00Z",
            endAt: "2026-07-01T02:00:00Z",
            category: { id: "1", title: "Work", color: "#f44336" },
            route: { id: "route-calculated-for-retry" },
        };
        const source = {
            provider: "GOOGLE" as const,
            calendarId: "google:primary",
            eventId: "event-10",
            occurrenceStartAt: "2026-07-01T01:00:00Z",
        };
        mockedApiPost.mockResolvedValue({
            success: true,
            data: { schedule: scheduleDto, created: false },
        });

        const result = await importCalendarSchedule(payload, source);
        expect(result).toMatchObject({
            item: { id: "10" },
            created: false,
        });
        expect(result.item.route).toBeUndefined();

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedules/import", {
            schedule: payload,
            source,
        });
    });

    test("keeps member-specific share permission metadata from schedule responses", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: [{
                ...scheduleDto,
                sharePermission: "EDITOR",
                category: {
                    ...scheduleDto.category,
                    shared: true,
                    sharePermission: "EDITOR",
                },
            }],
        });

        await expect(getDailySchedules("2026-07-01")).resolves.toMatchObject([{
            id: "10",
            sharePermission: "EDITOR",
            category: { shared: true, sharePermission: "EDITOR" },
        }]);
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

    test("keeps VIEWER and EDITOR metadata for received categories", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: [
                { id: 7, title: "보기 공유", color: "#007aff", shared: true, sharePermission: "VIEWER" },
                { id: 8, title: "편집 공유", color: "#34c759", shared: true, sharePermission: "EDITOR" },
            ],
        });

        await expect(getScheduleCategoriesFromApi()).resolves.toMatchObject([
            { id: "7", shared: true, sharePermission: "VIEWER" },
            { id: "8", shared: true, sharePermission: "EDITOR" },
        ]);
    });

    test("delete wrapper accepts an empty success envelope", async () => {
        mockedApiDelete.mockResolvedValue({ success: true });

        await expect(deleteScheduleCategoryFromApi("3")).resolves.toBeUndefined();

        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedule-categories/3");
    });
});

describe("default origin api wrappers", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("getDefaultOriginFromApi accepts an empty successful response", async () => {
        mockedApiGet.mockResolvedValue({ success: true, data: null });

        await expect(getDefaultOriginFromApi()).resolves.toBeNull();

        expect(mockedApiGet).toHaveBeenCalledWith("/api/favorite-places/default-origin");
    });

    test("saveDefaultOriginToApi sends normalized place data", async () => {
        mockedApiPut.mockResolvedValue({
            success: true,
            data: {
                id: 12,
                label: "집",
                placeName: "집",
                address: "서울 중구 세종대로 110",
                lat: 37.5665,
                lng: 126.978,
                provider: "TMAP",
                providerPlaceId: "home-1",
                defaultOrigin: true,
            },
        });

        await expect(saveDefaultOriginToApi({
            name: " 집 ",
            address: " 서울 중구 세종대로 110 ",
            lat: 37.5665,
            lng: 126.978,
            provider: " TMAP ",
            providerPlaceId: " home-1 ",
        })).resolves.toMatchObject({ id: "12", name: "집", defaultOrigin: true });

        expect(mockedApiPut).toHaveBeenCalledWith("/api/favorite-places/default-origin", {
            label: "집",
            placeName: "집",
            address: "서울 중구 세종대로 110",
            lat: 37.5665,
            lng: 126.978,
            provider: "TMAP",
            providerPlaceId: "home-1",
        });
    });

    test("clearDefaultOriginFromApi calls the dedicated delete endpoint", async () => {
        mockedApiDelete.mockResolvedValue({ success: true });

        await expect(clearDefaultOriginFromApi()).resolves.toBeUndefined();

        expect(mockedApiDelete).toHaveBeenCalledWith("/api/favorite-places/default-origin");
    });
});

describe("schedule sharing api wrappers", () => {
    const invitationDto = {
        id: "50",
        resourceType: "SCHEDULE",
        resourceId: "10",
        ownerMemberId: 1,
        permission: "VIEWER",
        status: "PENDING",
        expiresAt: "2026-07-11T12:00:00Z",
        maxAcceptCount: 1,
        acceptedCount: 0,
        token: "plain-token",
        acceptPath: "/api/share-invitations/plain-token/accept",
    };

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("invitation list wrappers call schedule, category and calendar endpoints", async () => {
        mockedApiGet.mockResolvedValue({ success: true, data: [invitationDto] });

        await expect(getScheduleShareInvitations("10")).resolves.toEqual([invitationDto]);
        await expect(getCategoryShareInvitations("3")).resolves.toEqual([invitationDto]);
        await expect(getCalendarShareInvitations("7")).resolves.toEqual([invitationDto]);

        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/10/shares/invitations");
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedule-categories/3/shares/invitations");
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedule-calendars/7/invitations");
    });

    test("share inbox and outbox wrappers call aggregate endpoints", async () => {
        mockedApiGet
            .mockResolvedValueOnce({
                success: true,
                data: { pendingInvitations: [], receivedShares: [] },
            })
            .mockResolvedValueOnce({
                success: true,
                data: { sharedResources: [], activeInvitations: [] },
            });

        await expect(getShareInbox()).resolves.toEqual({ pendingInvitations: [], receivedShares: [] });
        await expect(getShareOutbox()).resolves.toEqual({ sharedResources: [], activeInvitations: [] });

        expect(mockedApiGet).toHaveBeenCalledWith("/api/shares/inbox");
        expect(mockedApiGet).toHaveBeenCalledWith("/api/shares/outbox");
    });

    test("create invitation wrappers post link options", async () => {
        mockedApiPost.mockResolvedValue({ success: true, data: invitationDto });

        await expect(createScheduleShareInvitation("10", {
            permission: "VIEWER",
            contentMode: "SCHEDULE_AND_TRAVEL",
            ttlHours: 72,
            maxAcceptCount: 1,
        })).resolves.toMatchObject({ id: "50", token: "plain-token" });
        await expect(createCategoryShareInvitation("3", {
            permission: "EDITOR",
            ttlHours: 168,
            maxAcceptCount: 5,
        })).resolves.toMatchObject({ id: "50" });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedules/10/shares/invitations", {
            permission: "VIEWER",
            contentMode: "SCHEDULE_AND_TRAVEL",
            ttlHours: 72,
            maxAcceptCount: 1,
        });

        await expect(createCalendarShareInvitation("7", {
            permission: "EDITOR",
            ttlHours: 48,
            maxAcceptCount: 3,
        })).resolves.toMatchObject({ id: "50" });
        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedule-calendars/7/invitations", {
            permission: "EDITOR",
            ttlHours: 48,
            maxAcceptCount: 3,
        });
        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedule-categories/3/shares/invitations", {
            permission: "EDITOR",
            ttlHours: 168,
            maxAcceptCount: 5,
        });
    });

    test("direct share wrappers post either app id or email target", async () => {
        mockedApiPost.mockResolvedValue({
            success: true,
            data: {
                id: "80",
                resourceId: "10",
                ownerMemberId: 1,
                targetMemberId: 2,
                permission: "VIEWER",
                status: "ACTIVE",
            },
        });

        await createScheduleShare("10", {
            targetAppId: 2,
            permission: "VIEWER",
            contentMode: "SCHEDULE_AND_TRAVEL",
        });
        await createCategoryShare("3", { targetEmail: "friend@example.com", permission: "EDITOR" });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedules/10/shares", {
            targetAppId: 2,
            permission: "VIEWER",
            contentMode: "SCHEDULE_AND_TRAVEL",
        });
        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedule-categories/3/shares", {
            targetEmail: "friend@example.com",
            permission: "EDITOR",
        });
    });

    test("direct calendar share maps schedule permission to calendar role", async () => {
        mockedApiPost.mockResolvedValue({
            success: true,
            data: { id: 8, calendarId: 7, memberId: 2, role: "EDITOR", status: "ACTIVE" },
        });

        await expect(createCalendarShare("7", {
            targetEmail: "friend@example.com",
            permission: "EDITOR",
        })).resolves.toMatchObject({ calendarId: 7, role: "EDITOR" });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedule-calendars/7/members", {
            targetEmail: "friend@example.com",
            targetAppId: undefined,
            role: "EDITOR",
        });
    });

    test("accept invitation posts encoded token", async () => {
        mockedApiPost.mockResolvedValue({
            success: true,
            data: {
                invitation: { ...invitationDto, status: "ACCEPTED", token: undefined },
                share: {
                    id: "80",
                    resourceId: "10",
                    ownerMemberId: 1,
                    targetMemberId: 2,
                    permission: "VIEWER",
                    status: "ACTIVE",
                },
            },
        });

        await expect(acceptShareInvitation("token/with space")).resolves.toMatchObject({
            share: { id: "80" },
        });

        expect(mockedApiPost).toHaveBeenCalledWith("/api/share-invitations/token%2Fwith%20space/accept");
    });

    test("invitation revoke wrappers call their resource endpoints", async () => {
        mockedApiDelete.mockResolvedValue({ success: true });

        await expect(revokeScheduleShareInvitation("10", "50")).resolves.toBeUndefined();
        await expect(revokeCategoryShareInvitation("3", "51")).resolves.toBeUndefined();
        await expect(revokeCalendarShareInvitation("7", "52")).resolves.toBeUndefined();

        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedules/10/shares/invitations/50");
        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedule-categories/3/shares/invitations/51");
        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedule-calendars/7/invitations/52");
    });

    test("direct share revoke wrappers call their resource endpoints", async () => {
        mockedApiDelete.mockResolvedValue({ success: true });

        await expect(revokeScheduleShare("10", "60")).resolves.toBeUndefined();
        await expect(revokeCategoryShare("3", "61")).resolves.toBeUndefined();

        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedules/10/shares/60");
        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedule-categories/3/shares/61");
    });
});

describe("schedule calendar api wrappers", () => {
    const calendarDto = {
        id: 7,
        title: "가족",
        color: "#2F80FF",
        defaultContentMode: "SCHEDULE_AND_TRAVEL",
        status: "ACTIVE",
        ownerMemberId: 1,
        myRole: "OWNER",
        memberCount: 2,
        routeReminderEnabled: true,
    };

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("calendar list, create and update wrappers preserve sharing policy", async () => {
        mockedApiGet.mockResolvedValue({ success: true, data: [calendarDto] });
        mockedApiPost.mockResolvedValue({ success: true, data: calendarDto });
        mockedApiPatch.mockResolvedValue({ success: true, data: { ...calendarDto, title: "우리 가족" } });

        await expect(getScheduleCalendars()).resolves.toEqual([calendarDto]);
        await createScheduleCalendar({
            title: "가족",
            color: "#2F80FF",
            defaultContentMode: "SCHEDULE_AND_TRAVEL",
        });
        await updateScheduleCalendar(7, { title: "우리 가족" });

        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedule-calendars");
        expect(mockedApiPost).toHaveBeenCalledWith("/api/schedule-calendars", {
            title: "가족",
            color: "#2F80FF",
            defaultContentMode: "SCHEDULE_AND_TRAVEL",
        });
        expect(mockedApiPatch).toHaveBeenCalledWith("/api/schedule-calendars/7", { title: "우리 가족" });
    });

    test("member list, own reminder preference and archive use dedicated endpoints", async () => {
        mockedApiGet.mockResolvedValue({ success: true, data: [] });
        mockedApiPatch.mockResolvedValue({
            success: true,
            data: { id: 8, calendarId: 7, memberId: 2, role: "VIEWER", routeReminderEnabled: false },
        });
        mockedApiDelete.mockResolvedValue({ success: true });

        await expect(getScheduleCalendarMembers(7)).resolves.toEqual([]);
        await expect(updateMyScheduleCalendarPreferences(7, false)).resolves.toMatchObject({
            routeReminderEnabled: false,
        });
        await expect(archiveScheduleCalendar(7)).resolves.toBeUndefined();

        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedule-calendars/7/members");
        expect(mockedApiPatch).toHaveBeenCalledWith("/api/schedule-calendars/7/preferences", {
            routeReminderEnabled: false,
        });
        expect(mockedApiDelete).toHaveBeenCalledWith("/api/schedule-calendars/7");
    });
});

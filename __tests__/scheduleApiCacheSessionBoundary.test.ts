import { apiDelete, apiGet, apiPost, apiPut } from "../src/api/api";
import {
    createSchedule,
    deleteSchedule,
    getSchedule,
    importCalendarSchedule,
    markScheduleDeparted,
    snoozeScheduleDepartureReminder,
    synchronizeCalendarScheduleCacheRevision,
    updateSchedule,
} from "../src/api/schedule";
import {
    activateAuthSessionIfCurrent,
    advanceAuthSessionEpoch,
    beginAuthLoginSession,
} from "../src/modules/auth/authSessionEpoch";
import {
    clearCalendarScheduleCache,
    readCalendarScheduleCache,
    refreshCalendarScheduleCache,
} from "../src/modules/schedule/calendarScheduleCache";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("../src/api/api", () => ({
    apiDelete: jest.fn(),
    apiGet: jest.fn(),
    apiPost: jest.fn(),
    apiPut: jest.fn(),
}));

const mockedApiDelete = jest.mocked(apiDelete);
const mockedApiGet = jest.mocked(apiGet);
const mockedApiPost = jest.mocked(apiPost);
const mockedApiPut = jest.mocked(apiPut);
const RANGE_START = "2026-07-01T00:00:00.000Z";
const RANGE_END = "2026-07-31T23:59:59.999Z";

function item(title: string): ScheduleItem {
    return {
        id: "42",
        title,
        startAt: "2026-07-24T01:00:00.000Z",
        endAt: "2026-07-24T02:00:00.000Z",
        category: { id: "1", title: "기본", color: "#1D4ED8" },
    };
}

function envelope(schedule: ScheduleItem) {
    return {
        success: true,
        data: { ...schedule, id: Number(schedule.id) },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

async function primeCache(schedule: ScheduleItem) {
    await refreshCalendarScheduleCache(
        RANGE_START,
        RANGE_END,
        jest.fn().mockResolvedValue([schedule]),
    );
}

function cachedTitle(): string | undefined {
    return readCalendarScheduleCache(RANGE_START, RANGE_END)
        .items.find((candidate) => candidate.id === "42")
        ?.title;
}

beforeEach(() => {
    const epoch = beginAuthLoginSession();
    activateAuthSessionIfCurrent(epoch);
    clearCalendarScheduleCache();
    jest.clearAllMocks();
});

test.each([
    {
        name: "get",
        begin: (pending: Promise<unknown>) => {
            mockedApiGet.mockReturnValueOnce(pending as never);
            return getSchedule("42");
        },
        finish: envelope(item("A get")),
    },
    {
        name: "update",
        begin: (pending: Promise<unknown>) => {
            mockedApiPut.mockReturnValueOnce(pending as never);
            return updateSchedule("42", item("payload"));
        },
        finish: envelope(item("A update")),
    },
    {
        name: "create",
        begin: (pending: Promise<unknown>) => {
            mockedApiPost.mockReturnValueOnce(pending as never);
            return createSchedule(item("payload"));
        },
        finish: envelope(item("A create")),
    },
    {
        name: "import",
        begin: (pending: Promise<unknown>) => {
            mockedApiPost.mockReturnValueOnce(pending as never);
            return importCalendarSchedule(item("payload"), {
                provider: "APPLE_DEVICE",
                calendarId: "calendar",
                eventId: "event",
                occurrenceStartAt: "2026-07-24T01:00:00.000Z",
            });
        },
        finish: {
            success: true,
            data: {
                schedule: { ...item("A import"), id: 42 },
                created: true,
            },
        },
    },
    {
        name: "depart",
        begin: (pending: Promise<unknown>) => {
            mockedApiPost.mockReturnValueOnce(pending as never);
            return markScheduleDeparted("42");
        },
        finish: envelope(item("A depart")),
    },
    {
        name: "snooze",
        begin: (pending: Promise<unknown>) => {
            mockedApiPost.mockReturnValueOnce(pending as never);
            return snoozeScheduleDepartureReminder("42");
        },
        finish: envelope(item("A snooze")),
    },
])(
    "late A $name response cannot overwrite B cache with the same scheduleId",
    async ({ begin, finish }) => {
        const response = deferred<unknown>();
        const lateA = begin(response.promise);

        advanceAuthSessionEpoch();
        clearCalendarScheduleCache();
        await primeCache(item("B private"));
        response.resolve(finish);
        await lateA;

        expect(cachedTitle()).toBe("B private");
    },
);

test("late A delete cannot remove B cache item with the same scheduleId", async () => {
    const response = deferred<unknown>();
    mockedApiDelete.mockReturnValueOnce(response.promise as never);
    const lateA = deleteSchedule("42");

    advanceAuthSessionEpoch();
    clearCalendarScheduleCache();
    await primeCache(item("B private"));
    response.resolve({ success: true });
    await lateA;

    expect(cachedTitle()).toBe("B private");
});

test("late A cache revision response cannot clear B cache", async () => {
    mockedApiGet.mockResolvedValueOnce({ success: true, data: { revision: 1 } });
    await synchronizeCalendarScheduleCacheRevision();

    const response = deferred<unknown>();
    mockedApiGet.mockReturnValueOnce(response.promise as never);
    const lateA = synchronizeCalendarScheduleCacheRevision();

    advanceAuthSessionEpoch();
    clearCalendarScheduleCache();
    await primeCache(item("B private"));
    response.resolve({ success: true, data: { revision: 2 } });

    await expect(lateA).resolves.toBe(false);
    expect(cachedTitle()).toBe("B private");
});

test("same-session get still updates the shared calendar cache", async () => {
    await primeCache(item("old"));
    mockedApiGet.mockResolvedValueOnce(envelope(item("same session")));

    await getSchedule("42");

    expect(cachedTitle()).toBe("same session");
});

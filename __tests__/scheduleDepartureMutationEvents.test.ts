import type { ScheduleItem } from "../src/modules/schedule/types";
import {
    emitScheduleDepartureMutation,
    subscribeScheduleDepartureMutation,
    subscribeScheduleDepartureMutationForAuthSession,
} from "../src/modules/schedule/scheduleDepartureMutationEvents";
import {
    activateAuthSessionIfCurrent,
    advanceAuthSessionEpoch,
    beginAuthLoginSession,
    getAuthSessionEpoch,
} from "../src/modules/auth/authSessionEpoch";

const item: ScheduleItem = {
    id: "42",
    title: "출발 일정",
    startAt: "2026-07-24T10:00:00+09:00",
    endAt: "2026-07-24T11:00:00+09:00",
    myDepartedAt: "2026-07-24T09:20:00+09:00",
    category: { id: "1", title: "기본", color: "#2979FF" },
};

beforeEach(() => {
    const epoch = beginAuthLoginSession();
    activateAuthSessionIfCurrent(epoch);
});

test("authoritative depart 응답은 후속 status GET이 offline이어도 refreshing event에 지워지지 않는다", () => {
    let mountedItem: ScheduleItem | undefined;
    let refreshing = false;
    const unsubscribe = subscribeScheduleDepartureMutation((event) => {
        if (event.item) mountedItem = event.item;
        refreshing = event.refreshing === true;
    });

    emitScheduleDepartureMutation({
        authEpoch: getAuthSessionEpoch(),
        kind: "departed",
        scheduleId: "42",
        item,
        refreshing: true,
    });
    emitScheduleDepartureMutation({
        authEpoch: getAuthSessionEpoch(),
        kind: "snoozed",
        scheduleId: "42",
        refreshing: true,
    });

    expect(mountedItem?.myDepartedAt).toBe("2026-07-24T09:20:00+09:00");
    expect(refreshing).toBe(true);
    unsubscribe();
});

test("A 화면 listener는 같은 scheduleId의 current B event로 cache/UI를 갱신하지 않는다", () => {
    const aEpoch = getAuthSessionEpoch();
    const aScreenSideEffect = jest.fn();
    const unsubscribe = subscribeScheduleDepartureMutationForAuthSession(
        aEpoch,
        (event) => {
            if (event.scheduleId === "42") aScreenSideEffect(event);
        },
    );

    advanceAuthSessionEpoch();
    const bEpoch = beginAuthLoginSession();
    activateAuthSessionIfCurrent(bEpoch);
    expect(emitScheduleDepartureMutation({
        authEpoch: bEpoch,
        kind: "snoozed",
        scheduleId: "42",
        refreshing: true,
    })).toBe(true);

    expect(aScreenSideEffect).not.toHaveBeenCalled();
    unsubscribe();
});

test("mounted epoch와 event/current epoch가 같으면 상세 listener side effect를 허용한다", () => {
    const epoch = getAuthSessionEpoch();
    const currentScreenSideEffect = jest.fn();
    const unsubscribe = subscribeScheduleDepartureMutationForAuthSession(
        epoch,
        currentScreenSideEffect,
    );

    expect(emitScheduleDepartureMutation({
        authEpoch: epoch,
        kind: "departed",
        scheduleId: "42",
        refreshing: true,
    })).toBe(true);

    expect(currentScreenSideEffect).toHaveBeenCalledTimes(1);
    unsubscribe();
});

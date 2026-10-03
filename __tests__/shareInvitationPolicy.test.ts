jest.mock("expo-linking", () => ({ createURL: (path: string) => `nolate://${path}` }));
jest.mock("react-native-reanimated", () => {
    const transition = {
        springify() { return this; },
        damping() { return this; },
        stiffness() { return this; },
        mass() { return this; },
        overshootClamping() { return this; },
        reduceMotion() { return this; },
    };
    return {
        LinearTransition: transition,
        ReduceMotion: { System: "system" },
    };
});

import {
    getPermissionOptions,
    permissionLabel,
} from "../src/modules/schedule/components/share/shareInvitationModel";

describe("share invitation permission policy", () => {
    test.each([
        ["schedule", ["이 일정 조회", "이 일정 수정·삭제"]],
        ["category", ["현재·앞으로 추가되는 일정 조회", "이 카테고리의 일정 생성·수정·삭제"]],
        ["calendar", ["모든 카테고리와 일정 조회", "카테고리와 일정 생성·수정·삭제"]],
    ] as const)("%s shares expose only viewer and editor with scoped descriptions", (resourceType, descriptions) => {
        const options = getPermissionOptions(resourceType);

        expect(options.map(({ value }) => value)).toEqual(["VIEWER", "EDITOR"]);
        expect(options.map(({ description }) => description)).toEqual(descriptions);
    });

    test("legacy commenter invitations are presented as viewer access", () => {
        expect(permissionLabel("COMMENTER")).toBe("보기");
    });
});

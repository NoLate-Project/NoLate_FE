import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { ManageShareSheet } from "../src/routeSupport/share/ShareInboxManage";
import type { ShareLibraryItem } from "../src/modules/share/shareInboxPresentation";
import type { AppColors } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("../src/ui/BrandedLoader", () => ({
    __esModule: true,
    default: "BrandedLoader",
}));

const colors: AppColors = {
    background: "#fff",
    surface: "#fff",
    surface2: "#f7f7f8",
    border: "#e6e6ea",
    textPrimary: "#000",
    textSecondary: "#6e6e73",
    textDisabled: "#c7c7cc",
    selectedDayBg: "#000",
    selectedDayText: "#fff",
    todayBorderColor: "#000",
    calendarBackground: "#fff",
    dayHeaderColor: "#8e8e93",
    arrowColor: "#000",
    monthTextColor: "#000",
    inputBackground: "#f7f7f8",
    inputBorder: "#e6e6ea",
    inputBorderFocused: "#000",
    inputPlaceholder: "#8e8e93",
    switchActive: "#34C759",
};

const share = {
    id: "share-1",
    resourceId: "category-1",
    ownerMemberId: 1,
    targetMemberId: 2,
    targetEmail: "friend@example.com",
    permission: "VIEWER" as const,
    status: "ACTIVE" as const,
};

const item: ShareLibraryItem = {
    key: "CATEGORY:category-1",
    tab: "calendar",
    resourceType: "CATEGORY",
    resourceId: "category-1",
    title: "가족 일정",
    relation: "owned",
    permission: "OWNER",
    isPending: false,
    isUnseen: false,
    shareCount: 1,
    shares: [share],
    activeInvitations: [],
    routeState: null,
    searchText: "가족 일정 friend@example.com",
};

describe("ManageShareSheet permission controls", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
    });

    test("owner can change an accepted direct grant from viewer to editor", () => {
        const onChangeSharePermission = jest.fn();
        act(() => {
            renderer = TestRenderer.create(
                <ManageShareSheet
                    item={item}
                    colors={colors}
                    accent="#2F80FF"
                    bottomInset={0}
                    revokingShareId={null}
                    updatingShareId={null}
                    revokingInvitationId={null}
                    onClose={jest.fn()}
                    onOpenResource={jest.fn()}
                    onOpenComposer={jest.fn()}
                    onRevokeShare={jest.fn()}
                    onChangeSharePermission={onChangeSharePermission}
                    onRevokeInvitation={jest.fn()}
                />,
            );
        });

        act(() => {
            renderer!.root.findByProps({
                accessibilityLabel: "friend@example.com 권한을 편집로 변경",
            }).props.onPress();
        });

        expect(onChangeSharePermission).toHaveBeenCalledWith(share, "EDITOR");
    });
});

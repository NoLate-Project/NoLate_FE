import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import GlobalFloatingActionBar from "../src/modules/schedule/components/shared/GlobalFloatingActionBar";

jest.mock("@expo/vector-icons", () => {
    const ReactModule = jest.requireActual("react");
    return {
        Ionicons: (props: Record<string, unknown>) => ReactModule.createElement("Ionicons", props),
    };
});

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "dark",
        colors: {
            border: "#444444",
            textPrimary: "#FFFFFF",
            textSecondary: "#9A9AA0",
        },
    }),
}));

jest.mock(
    "../src/modules/schedule/components/calendar/CalendarGlassSurface",
    () => {
        const ReactModule = jest.requireActual("react");
        const { View } = jest.requireActual("react-native");
        return {
            __esModule: true,
            default: ({ children, ...props }: React.ComponentProps<typeof View>) => (
                ReactModule.createElement(View, props, children)
            ),
            liquidGlassTokens: {
                pressedScale: 0.96,
                spring: { damping: 22, stiffness: 230, mass: 0.9 },
            },
        };
    }
);

jest.mock(
    "../src/modules/schedule/components/calendar/LiquidGlassIconButton",
    () => ({
        __esModule: true,
        default: () => null,
        isLiquidGlassIconButtonAvailable: false,
    })
);

function findCalendarSelector(root: ReactTestInstance) {
    return root.findAll((node) => (
        node.props.accessibilityLabel === "현재 B E2E Shared, 캘린더 선택" &&
        typeof node.props.onPress === "function"
    ))[0];
}

describe("GlobalFloatingActionBar calendar selector", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllMocks();
    });

    it("keeps the bottom calendar selector icon-only with its full accessible name", async () => {
        const onPress = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <GlobalFloatingActionBar
                    rightActions={[{
                        key: "calendar-scope-selector",
                        icon: "calendar-outline",
                        accessibilityLabel: "현재 B E2E Shared, 캘린더 선택",
                        accessibilityState: { expanded: false },
                        onPress,
                    }, {
                        key: "notification-inbox",
                        icon: "notifications-outline",
                        accessibilityLabel: "알림함",
                        onPress: jest.fn(),
                    }]}
                />
            );
        });

        const selector = findCalendarSelector(renderer!.root);
        const icons = selector.findAll((node) => (
            (node.type as unknown) === "Ionicons" && typeof node.props.name === "string"
        ));

        expect(icons.map((icon) => icon.props.name)).toEqual(["calendar-outline"]);
        expect(selector.findAllByType(Text)).toHaveLength(0);
        expect(selector.props.accessibilityState).toEqual({ expanded: false });

        await act(async () => selector.props.onPress());
        expect(onPress).toHaveBeenCalledTimes(1);
    });
});

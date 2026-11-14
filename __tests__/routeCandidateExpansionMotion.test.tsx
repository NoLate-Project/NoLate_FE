import React from "react";
import { Animated } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { AnimatedRouteExpansion } from "../src/routeSupport/schedule/RouteSelectAnimatedControls";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));

it.each([
    { restored: true, reduceMotion: false, playsEntrance: false },
    { restored: false, reduceMotion: true, playsEntrance: false },
    { restored: false, reduceMotion: false, playsEntrance: true },
])("animates only new disclosures (%j)", async ({ restored, reduceMotion, playsEntrance }) => {
    const timing = jest.spyOn(Animated, "timing");
    let renderer: ReactTestRenderer | undefined;
    try {
        await act(async () => {
            renderer = TestRenderer.create(
                <AnimatedRouteExpansion restored={restored} reduceMotion={reduceMotion} style={undefined}>
                    {null}
                </AnimatedRouteExpansion>,
            );
        });
        expect(timing).toHaveBeenCalledTimes(playsEntrance ? 1 : 0);
    } finally {
        await act(async () => renderer?.unmount());
        timing.mockRestore();
    }
});

it.each([
    [false, 160],
    [true, undefined],
] as const)("uses the short return motion for a collapsed summary (reduced motion %s)", async (reduceMotion, duration) => {
    const timing = jest.spyOn(Animated, "timing");
    let renderer: ReactTestRenderer | undefined;
    try {
        await act(async () => {
            renderer = TestRenderer.create(
                <AnimatedRouteExpansion variant="summary" reduceMotion={reduceMotion} style={undefined}>
                    {null}
                </AnimatedRouteExpansion>,
            );
        });
        if (duration === undefined) expect(timing).not.toHaveBeenCalled();
        else expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration }));
    } finally {
        await act(async () => renderer?.unmount());
        timing.mockRestore();
    }
});

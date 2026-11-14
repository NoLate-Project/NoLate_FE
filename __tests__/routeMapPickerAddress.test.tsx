import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { reverseGeocodeToAddress } from "../src/modules/map/routingService";
import { useRouteSelectMapPickerController } from "../src/routeSupport/schedule/useRouteSelectMapPickerController";

jest.mock("../src/modules/map/routingService", () => ({
    reverseGeocodeToAddress: jest.fn(),
}));
jest.mock("../src/routeSupport/schedule/RouteSelectAnimatedControls", () => ({
    MAP_PICKER_FALLBACK_LAT: 37.56,
    MAP_PICKER_FALLBACK_LNG: 126.98,
}));

test("only the latest map tap determines the address and a failed lookup keeps the pin usable", async () => {
    const geocode = jest.mocked(reverseGeocodeToAddress);
    let resolveFirst!: (address: string) => void;
    let resolveSecond!: (address: undefined) => void;
    geocode
        .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
        .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));
    const applyPlaceToTarget = jest.fn();
    let controller!: ReturnType<typeof useRouteSelectMapPickerController>;
    function Harness() {
        controller = useRouteSelectMapPickerController({
            activeTarget: "origin",
            applyPlaceToTarget,
            onOpenMapPicker: jest.fn(),
            rememberRecentPlace: jest.fn(),
        });
        return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<Harness />); });
    act(() => controller.openMapForPointSelection());
    act(() => {
        void controller.selectMapPickerCoord({ latitude: 37.56, longitude: 126.98 });
        void controller.selectMapPickerCoord({ latitude: 37.57, longitude: 126.99 });
        controller.confirmMapPickerSelection("origin");
    });
    expect(applyPlaceToTarget).not.toHaveBeenCalled();

    await act(async () => { resolveFirst("이전 주소"); });
    expect(controller.mapPickerAddress).toBeUndefined();
    expect(controller.mapPickerResolving).toBe(true);

    await act(async () => { resolveSecond(undefined); });
    expect(controller.mapPickerAddressUnavailable).toBe(true);
    expect(controller.mapPickerResolving).toBe(false);
    act(() => {
        controller.confirmMapPickerSelection("origin");
        controller.confirmMapPickerSelection("origin");
    });
    expect(applyPlaceToTarget).toHaveBeenCalledTimes(1);
    expect(applyPlaceToTarget).toHaveBeenCalledWith("origin", {
        name: "지도 선택 출발지",
        address: undefined,
        lat: 37.57,
        lng: 126.99,
    });
    expect(controller.mapPickerAddressUnavailable).toBe(false);
    act(() => renderer.unmount());
});

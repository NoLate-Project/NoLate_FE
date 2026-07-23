import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn((key: string) => (
        key === "EXPO_PUBLIC_TMAP_APP_KEY" ? "native test key" : undefined
    )),
}));

jest.mock("expo-modules-core", () => {
    const ReactModule = require("react");
    const NativeView = ReactModule.forwardRef((props: Record<string, unknown>, _ref: unknown) => (
        ReactModule.createElement("NoLateTMapNativeMock", props)
    ));
    return {
        requireOptionalNativeModule: jest.fn(() => ({})),
        requireNativeViewManager: jest.fn(() => NativeView),
    };
});

import TmapMapView, {
    type TmapMapViewHandle,
} from "../src/modules/map/TmapMapView";

describe("Tmap native map facade", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("passes one data snapshot and preserves batched imperative commands", async () => {
        const ref = React.createRef<TmapMapViewHandle>();
        await act(async () => {
            renderer = TestRenderer.create(
                <TmapMapView
                    ref={ref}
                    camera={{ latitude: 37.5665, longitude: 126.978, zoom: 15 }}
                    markers={[{
                        id: "origin",
                        latitude: 37.5665,
                        longitude: 126.978,
                        markerStyle: "origin",
                    }]}
                    pathOverlays={[{
                        id: "route",
                        coords: [
                            { latitude: 37.5665, longitude: 126.978 },
                            { latitude: 37.57, longitude: 126.99 },
                        ],
                        color: "#00AA55",
                        nativeDirection: true,
                    }]}
                />
            );
        });

        let nativeView = renderer!.root.find(
            (node) => (node.type as unknown) === "NoLateTMapNativeMock"
        );
        expect(nativeView.props.appKey).toBe("native test key");
        expect(nativeView.props.data).toMatchObject({
            camera: { latitude: 37.5665, longitude: 126.978, zoom: 15 },
            markers: [{ id: "origin", markerStyle: "origin" }],
            pathOverlays: [{ id: "route", color: "#00AA55", nativeDirection: true }],
        });

        await act(async () => {
            ref.current?.zoomBy(1);
            ref.current?.fitToCoordinates([
                { latitude: 37.56, longitude: 126.97 },
                { latitude: 37.58, longitude: 127.01 },
            ], { padding: 60 });
        });

        nativeView = renderer!.root.find(
            (node) => (node.type as unknown) === "NoLateTMapNativeMock"
        );
        expect(nativeView.props.command).toMatchObject({
            sequence: 2,
            type: "batch",
            payload: {
                commands: [
                    { sequence: 1, type: "zoomBy", payload: { delta: 1 } },
                    { sequence: 2, type: "fitBounds", payload: { padding: 60 } },
                ],
            },
        });
    });

    it("forwards native ready, tap, marker, and camera events", async () => {
        const onInitialized = jest.fn();
        const onTapMap = jest.fn();
        const onMarkerPress = jest.fn();
        const onZoomChanged = jest.fn();
        const onCameraChanged = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <TmapMapView
                    camera={{ latitude: 37.5665, longitude: 126.978, zoom: 15 }}
                    onInitialized={onInitialized}
                    onTapMap={onTapMap}
                    onMarkerPress={onMarkerPress}
                    onZoomChanged={onZoomChanged}
                    onCameraChanged={onCameraChanged}
                />
            );
        });

        const nativeView = renderer!.root.find(
            (node) => (node.type as unknown) === "NoLateTMapNativeMock"
        );
        await act(async () => {
            nativeView.props.onMapReady({ nativeEvent: { sdkVersion: "3.7" } });
            nativeView.props.onMapTap({
                nativeEvent: { latitude: 37.57, longitude: 126.99 },
            });
            nativeView.props.onMarkerPress({
                nativeEvent: { id: "destination", interactionId: "select-destination" },
            });
            nativeView.props.onCameraChange({
                nativeEvent: {
                    latitude: 37.575,
                    longitude: 126.995,
                    zoom: 16,
                    metersPerPixel: 1.25,
                },
            });
        });

        expect(onInitialized).toHaveBeenCalledTimes(1);
        expect(onTapMap).toHaveBeenCalledWith({ latitude: 37.57, longitude: 126.99 });
        expect(onMarkerPress).toHaveBeenCalledWith({
            id: "destination",
            interactionId: "select-destination",
        });
        expect(onCameraChanged).toHaveBeenCalledWith({
            latitude: 37.575,
            longitude: 126.995,
            zoom: 16,
            metersPerPixel: 1.25,
        });
        expect(onZoomChanged).toHaveBeenCalledWith(16);
    });
});

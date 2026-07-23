import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn((key: string) => (
        key === "EXPO_PUBLIC_TMAP_APP_KEY" ? "vector test key" : undefined
    )),
}));

jest.mock("react-native-webview", () => {
    const ReactModule = require("react");
    const WebView = ReactModule.forwardRef((props: Record<string, unknown>, ref: unknown) => {
        ReactModule.useImperativeHandle(ref, () => ({ postMessage: jest.fn() }));
        return ReactModule.createElement("WebViewMock", props);
    });
    return { WebView };
});

import TmapMapView from "../src/modules/map/TmapMapView";

function extractBootstrapFunction(html: string, functionName: string, nextFunctionName: string): string {
    const startToken = `function ${functionName}(`;
    const nextToken = `function ${nextFunctionName}(`;
    const start = html.indexOf(startToken);
    const end = html.indexOf(nextToken, start + startToken.length);
    if (start < 0 || end < 0) throw new Error(`Could not find ${functionName} in TMAP bootstrap`);
    return html.slice(start, end);
}

describe("Tmap Vector WebView bootstrap", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("Vector JS v3만 로드하고 ConfigLoad 이후 overlay를 초기화한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TmapMapView camera={{ latitude: 37.5665, longitude: 126.978, zoom: 15 }} />
            );
        });

        const webView = renderer!.root.find((node) => (node.type as unknown) === "WebViewMock");
        const html = (webView.props.source as { html: string }).html;

        expect(html).toContain(
            "https://apis.openapi.sk.com/tmap/vectorjs?version=1&appKey=vector%20test%20key"
        );
        expect(html).toContain('new Tmapv3.Map("map"');
        expect(html).toContain('map.on("ConfigLoad", handleVectorConfigLoaded)');
        expect(html).toContain('map.on("StyleLoad", finishMapInitialization)');
        expect(html).toContain("new Tmapv3.Marker");
        expect(html).toContain("new Tmapv3.Polyline");
        expect(html).toContain("supportsDirectionColor: false");
        expect(html).toContain("row.usableForRouteLine = row.supportsDirection;");
        expect(html).toContain("lineOptions.direction = true;");
        expect(html).not.toContain("lineOptions.directionColor =");
        expect(html).not.toContain("lineOptions.directionOpacity =");
        expect(html).not.toContain("drawCanvasDirectionalArrows(ctx, points, item);");
        const directionProbe = extractBootstrapFunction(
            html,
            "probeTmapNativeDirectionSupport",
            "escapeXml"
        );
        expect(directionProbe).not.toContain("map: map");
        expect(html).toContain('target.closest(".vsm-marker")');
        expect(html).toContain('layer.getMap() === map');
        expect(html).toContain("nativeOverlayItems.sort");
        expect(html.match(/var map = null;/g)).toHaveLength(1);
        expect(html).not.toContain("Tmapv2");
        expect(html).not.toContain("/tmap/jsv2");
        expect(html).not.toContain('querySelectorAll("img")');

        const inlineScripts = Array.from(
            html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
            (match) => match[1]
        );
        const bootstrapScript = inlineScripts.at(-1);
        expect(bootstrapScript).toBeTruthy();
        // 컴파일만 수행해 WebView 템플릿의 JavaScript 문법 오류를 회귀 방지한다.
        // eslint-disable-next-line no-new-func
        expect(() => Function(bootstrapScript!)).not.toThrow();
    });

    it("마커의 DOM 터치를 지도 좌표 선택으로 처리하지 않는다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TmapMapView camera={{ latitude: 37.5665, longitude: 126.978, zoom: 15 }} />
            );
        });

        const webView = renderer!.root.find((node) => (node.type as unknown) === "WebViewMock");
        const html = (webView.props.source as { html: string }).html;
        const source = extractBootstrapFunction(html, "isMarkerDomInteraction", "bindMapTap");
        // eslint-disable-next-line no-new-func
        const isMarkerDomInteraction = Function(`${source}; return isMarkerDomInteraction;`)() as (
            event: unknown
        ) => boolean;

        expect(isMarkerDomInteraction({
            data: {
                domEvent: {
                    target: { closest: (selector: string) => selector === ".vsm-marker" ? {} : null },
                },
            },
        })).toBe(true);
        expect(isMarkerDomInteraction({
            data: {
                domEvent: {
                    target: { closest: () => null, parentElement: null },
                },
            },
        })).toBe(false);
    });

    it("이미 붙은 Vector Polyline에는 setMap을 다시 호출하지 않는다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <TmapMapView camera={{ latitude: 37.5665, longitude: 126.978, zoom: 15 }} />
            );
        });

        const webView = renderer!.root.find((node) => (node.type as unknown) === "WebViewMock");
        const html = (webView.props.source as { html: string }).html;
        const source = extractBootstrapFunction(html, "ensureRouteLayerAttached", "getRouteOverlayRegistryRows");
        const map = {};
        // eslint-disable-next-line no-new-func
        const ensureRouteLayerAttached = Function(
            "map",
            `${source}; return ensureRouteLayerAttached;`
        )(map) as (item: Record<string, unknown>) => boolean;
        const setMap = jest.fn();
        const line = { getMap: jest.fn(() => map), setMap };
        const item = { line, outline: null, attachedToMap: true, visible: true };

        expect(ensureRouteLayerAttached(item)).toBe(true);
        expect(setMap).not.toHaveBeenCalled();
    });
});

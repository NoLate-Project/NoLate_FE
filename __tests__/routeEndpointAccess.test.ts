import {
    buildRouteEndpointAccessRequests,
    resolveRouteEndpointAccessPath,
    type RouteEndpointAccessRequest,
} from "../src/modules/map/routeEndpointAccess";

const coord = (lat: number, lng: number) => ({ lat, lng });

describe("routeEndpointAccess", () => {
    it("10m 미만의 공급자 좌표 오차는 접근선으로 만들지 않는다", () => {
        const requests = buildRouteEndpointAccessRequests(
            "route",
            [coord(37.50005, 127), coord(37.51, 127.01)],
            coord(37.5, 127),
            coord(37.51005, 127.01)
        );

        expect(requests).toEqual([]);
    });

    it("출발과 도착 접근 요청을 전체 이동 방향으로 만든다", () => {
        const origin = coord(37.5, 127);
        const routeStart = coord(37.5005, 127);
        const routeEnd = coord(37.51, 127.01);
        const destination = coord(37.511, 127.01);

        const requests = buildRouteEndpointAccessRequests(
            "route",
            [routeStart, routeEnd],
            origin,
            destination
        );

        expect(requests).toHaveLength(2);
        expect(requests[0]).toMatchObject({ position: "start", from: origin, to: routeStart });
        expect(requests[1]).toMatchObject({ position: "end", from: routeEnd, to: destination });
    });

    it("300m를 넘는 도로망 끝점 오차는 접근 경로로 꾸미지 않는다", () => {
        const requests = buildRouteEndpointAccessRequests(
            "route",
            [coord(37.504, 127), coord(37.51, 127.01)],
            coord(37.5, 127),
            coord(37.51005, 127.01)
        );

        expect(requests).toEqual([]);
    });

    it("24m 이하의 짧은 gap은 직접 접근선으로 연결한다", () => {
        const request: RouteEndpointAccessRequest = {
            id: "short",
            position: "start",
            from: coord(37.5, 127),
            to: coord(37.50018, 127),
            gapMeters: 20,
        };

        expect(resolveRouteEndpointAccessPath(request)).toEqual({
            id: "short",
            position: "start",
            pathCoords: [request.from, request.to],
            schematicPaths: [],
        });
    });

    it("보행 경로의 짧은 양 끝 오차를 실제 끝점에 맞춘다", () => {
        const request: RouteEndpointAccessRequest = {
            id: "walk",
            position: "end",
            from: coord(37.5, 127),
            to: coord(37.501, 127.001),
            gapMeters: 140,
        };
        const resolved = resolveRouteEndpointAccessPath(request, [
            coord(37.5001, 127),
            coord(37.5005, 127.0005),
            coord(37.5009, 127.001),
        ]);

        expect(resolved?.pathCoords[0]).toEqual(request.from);
        expect(resolved?.pathCoords.at(-1)).toEqual(request.to);
        expect(resolved?.schematicPaths).toEqual([]);
    });

    it("공급자 보행 경로가 반대 순서여도 전체 이동 방향으로 정렬한다", () => {
        const request: RouteEndpointAccessRequest = {
            id: "reversed",
            position: "start",
            from: coord(37.5, 127),
            to: coord(37.501, 127.001),
            gapMeters: 140,
        };
        const resolved = resolveRouteEndpointAccessPath(request, [
            coord(37.5009, 127.001),
            coord(37.5005, 127.0005),
            coord(37.5001, 127),
        ]);

        expect(resolved?.pathCoords[0]).toEqual(request.from);
        expect(resolved?.pathCoords.at(-1)).toEqual(request.to);
    });

    it("짧은 끝점 gap에 비해 과도하게 우회하는 보행 경로를 거부한다", () => {
        const request: RouteEndpointAccessRequest = {
            id: "detour",
            position: "start",
            from: coord(37.5, 127),
            to: coord(37.50065, 127),
            gapMeters: 72,
        };
        const resolved = resolveRouteEndpointAccessPath(request, [
            coord(37.5, 127),
            coord(37.503, 127.003),
            coord(37.50065, 127),
        ]);

        expect(resolved).toBeUndefined();
    });

    it("공급자 망 오차는 120m 안에서만 별도 도식선으로 분리한다", () => {
        const request: RouteEndpointAccessRequest = {
            id: "network-gap",
            position: "end",
            from: coord(37.5, 127),
            to: coord(37.502, 127),
            gapMeters: 220,
        };
        const providerPath = [coord(37.5009, 127), coord(37.5019, 127)];
        const resolved = resolveRouteEndpointAccessPath(request, providerPath);

        expect(resolved?.schematicPaths).toHaveLength(1);
        expect(resolved?.schematicPaths[0][0]).toEqual(request.from);

        const rejected = resolveRouteEndpointAccessPath(request, [
            coord(37.5012, 127),
            coord(37.5019, 127),
        ]);
        expect(rejected).toBeUndefined();
    });
});

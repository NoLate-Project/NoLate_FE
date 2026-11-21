import axios from "axios";
import * as core from "../src/modules/map/tmapApiCore";
import { parseFullAddressGeoResults, pickPoiSearchCoord, searchViaTmapPoi } from "../src/modules/map/tmapPlaceSearch";

describe("TMAP route endpoint search", () => {
    afterEach(() => jest.restoreAllMocks());

    test("uses the opposite endpoint as a distance reference and only sends an explicit radius", async () => {
        const client = axios.create();
        const get = jest.spyOn(client, "get").mockResolvedValue({
            data: { searchPoiInfo: { pois: { poi: [{ name: "동대구역", noorLat: "35.87943", noorLon: "128.62838" }] } } },
        });
        jest.spyOn(core, "tmapClient").mockReturnValue(client);
        const center = { lat: 37.55468, lng: 126.97065 };
        const [station] = await searchViaTmapPoi("동대구역", { center });
        expect(station.distanceMeters).toBeGreaterThan(200000);
        const params = get.mock.calls[0][1]?.params;
        expect(params).toMatchObject({ centerLat: String(center.lat), centerLon: String(center.lng) });
        expect(params).not.toHaveProperty("radius");

        await searchViaTmapPoi("약국", { center, radiusKm: 5 });
        expect(get.mock.calls[1][1]?.params).toMatchObject({ radius: "5" });
    });

    test("uses one complete geocoder coordinate pair and discards rows without one", () => {
        const coordinate = [
            { newLat: "", newLon: "", lat: "35.876148", lon: "128.627723" },
            { newLat: "37.5", newLon: " ", lat: "35.87", lon: "128.62" },
            { newLat: "35.8", newLon: "128.6", lat: "35.0", lon: "129.0" },
            { newLat: "100", newLon: "128", lat: "", lon: "128" },
            { newLat: "", newLon: "128", lat: "35", lon: "" },
        ];
        const items = parseFullAddressGeoResults({ coordinateInfo: { coordinate } }, "동대구역");
        expect(items.map(({ lat, lng }) => [lat, lng])).toEqual([
            [35.876148, 128.627723], [35.87, 128.62], [35.8, 128.6],
        ]);
        expect(pickPoiSearchCoord({ pnsLat: " ", pnsLon: "", frontLat: "35.87", frontLon: "128.62" }))
            .toEqual({ lat: 35.87, lng: 128.62 });
    });
});

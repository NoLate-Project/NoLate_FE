import {
    getFavoriteDeparturePlaces,
    saveFavoriteDeparturePlace,
} from "../src/modules/schedule/favoriteDeparture";
import * as SecureStorage from "../src/modules/storage/secureStorage";
import {
    getDefaultOriginFromApi,
    saveDefaultOriginToApi,
} from "../src/api/favoritePlaces";

jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

jest.mock("../src/api/favoritePlaces", () => ({
    clearDefaultOriginFromApi: jest.fn(),
    getDefaultOriginFromApi: jest.fn(),
    saveDefaultOriginToApi: jest.fn(),
}));

jest.mock("../src/api/recentRoutePlaces", () => ({
    deleteRecentRoutePlaceFromApi: jest.fn(),
    getRecentRoutePlacesFromApi: jest.fn(),
    saveRecentRoutePlaceToApi: jest.fn(),
}));

const FAVORITE_DEPARTURE_PLACES_KEY = "nolate_favorite_departure_places_v1";
const mockedGetItem = jest.mocked(SecureStorage.getItemAsync);
const mockedSetItem = jest.mocked(SecureStorage.setItemAsync);
const mockedGetDefaultOrigin = jest.mocked(getDefaultOriginFromApi);
const mockedSaveDefaultOrigin = jest.mocked(saveDefaultOriginToApi);

describe("favorite departure synchronization", () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        jest.clearAllMocks();
        storage.clear();
        mockedGetItem.mockImplementation(async (key) => storage.get(key) ?? null);
        mockedSetItem.mockImplementation(async (key, value) => {
            storage.set(key, value);
        });
    });

    test("uses the account default origin before locally cached candidates", async () => {
        storage.set(FAVORITE_DEPARTURE_PLACES_KEY, JSON.stringify([
            { name: "예전 집", lat: 37.1, lng: 127.1 },
        ]));
        mockedGetDefaultOrigin.mockResolvedValue({
            id: "7",
            name: "새 집",
            address: "서울 중구",
            lat: 37.5665,
            lng: 126.978,
            defaultOrigin: true,
        });

        const places = await getFavoriteDeparturePlaces();

        expect(places.map((place) => place.name)).toEqual(["새 집", "예전 집"]);
        expect(mockedSaveDefaultOrigin).not.toHaveBeenCalled();
        expect(JSON.parse(storage.get(FAVORITE_DEPARTURE_PLACES_KEY) ?? "[]")[0]).toMatchObject({
            name: "새 집",
            lat: 37.5665,
            lng: 126.978,
        });
    });

    test("migrates the legacy local default when the account has no server value", async () => {
        const legacyOrigin = { name: "회사", address: "서울 강남구", lat: 37.4979, lng: 127.0276 };
        storage.set(FAVORITE_DEPARTURE_PLACES_KEY, JSON.stringify([legacyOrigin]));
        mockedGetDefaultOrigin.mockResolvedValue(null);
        mockedSaveDefaultOrigin.mockResolvedValue({
            ...legacyOrigin,
            id: "9",
            defaultOrigin: true,
        });

        const places = await getFavoriteDeparturePlaces();

        expect(mockedSaveDefaultOrigin).toHaveBeenCalledWith(legacyOrigin);
        expect(places[0]).toMatchObject({ id: "9", name: "회사" });
    });

    test("keeps the local selection but reports an account save failure", async () => {
        const selected = { name: "서울역", lat: 37.5559, lng: 126.9723 };
        mockedSaveDefaultOrigin.mockRejectedValue(new Error("offline"));

        await expect(saveFavoriteDeparturePlace(selected)).rejects.toThrow("offline");

        expect(JSON.parse(storage.get(FAVORITE_DEPARTURE_PLACES_KEY) ?? "[]")[0]).toMatchObject(selected);
    });
});

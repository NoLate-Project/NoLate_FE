import { apiDelete, apiPatch } from "../src/api/api";
import {
    deleteFavoritePlaceCategoryFromApi,
    deleteFavoritePlaceFromApi,
    reorderFavoritePlaceCategoriesToApi,
    reorderFavoritePlacesToApi,
    setFavoritePlaceAsDefaultOriginToApi,
    updateFavoritePlaceCategoryToApi,
    updateFavoritePlaceToApi,
} from "../src/api/favoritePlaces";

jest.mock("../src/api/api", () => ({
    apiDelete: jest.fn(),
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
    apiPut: jest.fn(),
}));

const mockedApiDelete = jest.mocked(apiDelete);
const mockedApiPatch = jest.mocked(apiPatch);

describe("favorite place management api wrappers", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("updates, deletes, and reorders favorite place categories", async () => {
        mockedApiPatch
            .mockResolvedValueOnce({
                success: true,
                data: {
                    id: 4,
                    name: " 출퇴근 ",
                    color: " #30D158 ",
                    iconKey: " briefcase ",
                    sortOrder: 1,
                },
            })
            .mockResolvedValueOnce({
                success: true,
                data: [
                    { id: 8, name: "운동", color: "#FF9500", sortOrder: 0 },
                    { id: 4, name: "출퇴근", color: "#30D158", sortOrder: 1 },
                ],
            });
        mockedApiDelete.mockResolvedValue({ success: true });

        await expect(updateFavoritePlaceCategoryToApi("4", {
            name: " 출퇴근 ",
            color: " #30D158 ",
            iconKey: " briefcase ",
            sortOrder: 1,
        })).resolves.toEqual({
            id: "4",
            name: "출퇴근",
            color: "#30D158",
            iconKey: "briefcase",
            sortOrder: 1,
        });
        await expect(reorderFavoritePlaceCategoriesToApi([
            { id: "8", sortOrder: 0 },
            { id: "4", sortOrder: 1 },
        ])).resolves.toMatchObject([
            { id: "8", name: "운동", sortOrder: 0 },
            { id: "4", name: "출퇴근", sortOrder: 1 },
        ]);
        await expect(deleteFavoritePlaceCategoryFromApi("4")).resolves.toBeUndefined();

        expect(mockedApiPatch).toHaveBeenNthCalledWith(1, "/api/favorite-place-categories/4", {
            name: "출퇴근",
            color: "#30D158",
            iconKey: "briefcase",
            sortOrder: 1,
        });
        expect(mockedApiPatch).toHaveBeenNthCalledWith(2, "/api/favorite-place-categories/reorder", {
            items: [
                { id: 8, sortOrder: 0 },
                { id: 4, sortOrder: 1 },
            ],
        });
        expect(mockedApiDelete).toHaveBeenCalledWith("/api/favorite-place-categories/4");
    });

    test("updates a favorite place with a numeric category id and normalizes the response", async () => {
        mockedApiPatch.mockResolvedValue({
            success: true,
            data: {
                id: 12,
                categoryId: 4,
                category: { id: 4, name: " 출퇴근 " },
                label: " 회사 ",
                address: " 서울 중구 세종대로 110 ",
                lat: 37.5665,
                lng: 126.978,
                provider: " TMAP ",
                providerPlaceId: " office-1 ",
                defaultOrigin: true,
                sortOrder: 0,
            },
        });

        await expect(updateFavoritePlaceToApi("12", {
            categoryId: "4",
            label: " 회사 ",
            address: " 서울 중구 세종대로 110 ",
            provider: " TMAP ",
            providerPlaceId: " office-1 ",
            defaultOrigin: true,
        })).resolves.toMatchObject({
            id: "12",
            categoryId: "4",
            categoryName: "출퇴근",
            name: "회사",
            address: "서울 중구 세종대로 110",
            provider: "TMAP",
            providerPlaceId: "office-1",
            defaultOrigin: true,
        });

        expect(mockedApiPatch).toHaveBeenCalledWith("/api/favorite-places/12", {
            categoryId: 4,
            label: "회사",
            address: "서울 중구 세종대로 110",
            provider: "TMAP",
            providerPlaceId: "office-1",
            defaultOrigin: true,
        });
    });

    test("uses clearCategory when a favorite place is moved out of a category", async () => {
        mockedApiPatch.mockResolvedValue({
            success: true,
            data: {
                id: 12,
                label: "회사",
                address: "서울 중구 세종대로 110",
                lat: 37.5665,
                lng: 126.978,
            },
        });

        await updateFavoritePlaceToApi("12", { categoryId: null });

        expect(mockedApiPatch).toHaveBeenCalledWith("/api/favorite-places/12", {
            clearCategory: true,
        });
    });

    test("deletes, sets the default origin, and reorders favorite places", async () => {
        mockedApiDelete.mockResolvedValue({ success: true });
        mockedApiPatch
            .mockResolvedValueOnce({
                success: true,
                data: {
                    id: 12,
                    label: "회사",
                    lat: 37.5665,
                    lng: 126.978,
                    defaultOrigin: true,
                },
            })
            .mockResolvedValueOnce({
                success: true,
                data: [
                    { id: 13, label: "헬스장", lat: 37.5, lng: 127.1, sortOrder: 0 },
                    { id: 12, label: "회사", lat: 37.5665, lng: 126.978, sortOrder: 1 },
                ],
            });

        await expect(deleteFavoritePlaceFromApi("11")).resolves.toBeUndefined();
        await expect(setFavoritePlaceAsDefaultOriginToApi("12")).resolves.toMatchObject({
            id: "12",
            name: "회사",
            defaultOrigin: true,
        });
        await expect(reorderFavoritePlacesToApi([
            { id: "13", sortOrder: 0 },
            { id: "12", sortOrder: 1 },
        ])).resolves.toMatchObject([
            { id: "13", name: "헬스장", sortOrder: 0 },
            { id: "12", name: "회사", sortOrder: 1 },
        ]);

        expect(mockedApiDelete).toHaveBeenCalledWith("/api/favorite-places/11");
        expect(mockedApiPatch).toHaveBeenNthCalledWith(1, "/api/favorite-places/12/default-origin");
        expect(mockedApiPatch).toHaveBeenNthCalledWith(2, "/api/favorite-places/reorder", {
            items: [
                { id: 13, sortOrder: 0 },
                { id: 12, sortOrder: 1 },
            ],
        });
    });
});

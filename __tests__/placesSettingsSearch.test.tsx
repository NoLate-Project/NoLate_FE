import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { createFavoritePlaceCategoryToApi, getFavoritePlaceCategoriesFromApi } from "../src/api/favoritePlaces";
import { searchAddressByKeyword, type PlaceSearchItem } from "../src/modules/map/routingService";
import { usePlacesSettings } from "../src/routeSupport/settings/usePlacesSettings";

jest.mock("expo-router", () => ({ useRouter: () => ({}) }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../src/api/favoritePlaces", () => ({
    getFavoritePlacesFromApi: async () => [],
    getFavoritePlaceCategoriesFromApi: jest.fn(async () => []),
    getDefaultOriginFromApi: async () => null,
    createFavoritePlaceCategoryToApi: jest.fn(),
}));
jest.mock("../src/modules/map/routingService", () => ({ searchAddressByKeyword: jest.fn() }));
jest.mock("../src/modules/schedule/favoriteDeparture", () => ({}));
jest.mock("../src/modules/theme/ThemeContext", () => ({ useTheme: () => ({ mode: "light", colors: {} }) }));

it("isolates searches across sheets and keeps the selected result when returning from the editor", async () => {
    const cityHall = { name: "시청역", address: "서울 중구", lat: 37.5657, lng: 126.9768 };
    let resolveOld!: (results: PlaceSearchItem[]) => void;
    let resolveCurrent!: (results: PlaceSearchItem[]) => void;
    const search = jest.mocked(searchAddressByKeyword);
    search.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
        .mockImplementationOnce(() => new Promise(resolve => { resolveCurrent = resolve; }));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    let current!: ReturnType<typeof usePlacesSettings>;
    let renderer: ReturnType<typeof TestRenderer.create> | undefined;
    function Harness() {
        current = usePlacesSettings();
        return null;
    }
    try {
        await act(async () => { renderer = TestRenderer.create(<Harness />); });
        act(() => {
            current.openSearch("default");
            current.changeSearchQuery("서울역");
        });
        act(() => { void current.performSearch(); });
        act(() => {
            current.closeSheet();
            current.openSearch("favorite");
            current.changeSearchQuery("시청역");
        });
        act(() => { void current.performSearch(); });

        await act(async () => { resolveOld([]); });
        expect(alert).not.toHaveBeenCalled();
        expect(current.searching).toBe(true);
        await act(async () => { resolveCurrent([cityHall]); });
        expect(current.searchResults).toEqual([cityHall]);

        act(() => { current.chooseSearchResult(cityHall); });
        expect(current.sheet?.kind).toBe("placeEditor");
        act(() => { current.closeSheet(); });
        expect(current.searchQuery).toBe("시청역");
        expect(current.searchResults).toEqual([cityHall]);

        act(() => { current.changeSearchQuery("종각역"); });
        expect(current.searchResults).toEqual([]);
        expect(current.searchCompleted).toBe(false);
        search.mockResolvedValueOnce([]);
        await act(async () => { await current.performSearch(true); });
        expect(current.searchCompleted).toBe(true);
        expect(current.searchResults).toEqual([]);
        expect(alert).not.toHaveBeenCalled();
    } finally {
        await act(async () => { renderer?.unmount(); });
        alert.mockRestore();
    }
});

it("returns from category creation to the same favorite draft and search results", async () => {
    const place = { name: "시청역", address: "서울 중구", lat: 37.5657, lng: 126.9768 };
    const category = { id: "7", name: "업무", color: "#2563EB" };
    jest.mocked(searchAddressByKeyword).mockResolvedValueOnce([place]);
    const createCategory = jest.mocked(createFavoritePlaceCategoryToApi);
    createCategory.mockResolvedValueOnce(category);
    let current!: ReturnType<typeof usePlacesSettings>;
    function Harness() {
        current = usePlacesSettings();
        return null;
    }
    let renderer: ReturnType<typeof TestRenderer.create> | undefined;
    try {
        await act(async () => { renderer = TestRenderer.create(<Harness />); });
        act(() => {
            current.openSearch("favorite");
            current.changeSearchQuery("시청역");
        });
        await act(async () => { await current.performSearch(); });
        act(() => { current.chooseSearchResult(place); });
        act(() => {
            current.setSheet(sheet => sheet?.kind === "placeEditor" ? { ...sheet, label: "회의 장소" } : sheet);
            current.openCategoryEditor();
        });
        expect(current.sheet).toMatchObject({ kind: "categoryEditor" });
        act(() => { current.closeSheet(); });
        expect(current.sheet).toMatchObject({ kind: "placeEditor", label: "회의 장소" });

        act(() => { current.openCategoryEditor(); });
        act(() => {
            current.setSheet(sheet => sheet?.kind === "categoryEditor" ? { ...sheet, name: category.name } : sheet);
        });
        jest.mocked(getFavoritePlaceCategoriesFromApi).mockResolvedValueOnce([category]);
        await act(async () => { await current.saveCategoryEditor(); });
        expect(createCategory).toHaveBeenCalledWith(category.name, category.color);
        expect(current.sheet).toMatchObject({ kind: "placeEditor", label: "회의 장소", categoryId: category.id });
        expect(current.categories).toContainEqual(category);
        act(() => { current.closeSheet(); });
        expect(current.sheet).toEqual({ kind: "search", mode: "favorite" });
        expect(current.searchResults).toEqual([place]);
    } finally {
        await act(async () => { renderer?.unmount(); });
    }
});

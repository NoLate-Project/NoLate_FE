import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Keyboard,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { usePreMountedSceneActivity } from "../../modules/performance/preMountedSceneActivity";

import {
  createFavoritePlaceCategoryToApi,
  deleteFavoritePlaceFromApi,
  getFavoritePlaceCategoriesFromApi,
  getFavoritePlacesFromApi,
  saveFavoritePlaceToApi,
  updateFavoritePlaceToApi,
  type FavoritePlace,
  type FavoritePlaceCategory,
} from "../../api/favoritePlaces";
import {
  clearFavoriteDeparturePlaces,
  saveFavoriteDepartureFavorite,
  saveFavoriteDeparturePlace,
} from "../../modules/schedule/favoriteDeparture";
import {
  buildFavoritePlaceTabs,
  findMatchingFavoritePlaces,
  isReservedFavoritePlaceCategoryName,
  mergeLoadedFavoritePlaces,
  resolveManagedDefaultOriginSync,
  selectFavoritePlacesByTab,
  upsertFavoritePlace,
} from "../../modules/schedule/favoritePlaceSelection";
import {
  resolveDefaultOriginUiUpdate,
  type RoutePointTarget,
} from "../../modules/schedule/routePointSelection";
import type { Place } from "../../modules/schedule/types";
import {
  FAVORITE_CATEGORY_COLORS,
  configureRouteExpansionAnimation,
} from "./RouteSelectAnimatedControls";
import {
  getPlaceActionKey,
  getPlaceDisplayText,
  placeHasCoords,
} from "./routeSelectPlaceModel";

type RouteSelectFavoriteControllerOptions = {
  applyPlaceToTarget: (target: RoutePointTarget, place: Place) => void;
  clearSearch: () => void;
  destinationHasCoordinatesRef: MutableRefObject<boolean>;
  forcedEditTarget?: RoutePointTarget;
  origin?: Place;
  originTouchedRef: MutableRefObject<boolean>;
  originUsesDefault: boolean;
  routePointUiRevisionRef: MutableRefObject<number>;
  setActiveTarget: Dispatch<SetStateAction<RoutePointTarget>>;
  setIsEditingRoutePoint: Dispatch<SetStateAction<boolean>>;
  setOriginAddress: Dispatch<SetStateAction<string | undefined>>;
  setOriginLat: Dispatch<SetStateAction<number | undefined>>;
  setOriginLng: Dispatch<SetStateAction<number | undefined>>;
  setOriginText: Dispatch<SetStateAction<string>>;
  setOriginUsesDefault: Dispatch<SetStateAction<boolean>>;
};

/**
 * 경로 선택 화면의 즐겨찾기 조회·필터·저장·삭제와 기본 출발지 동기화를 전담한다.
 * 장소 입력 상태는 상위 컨트롤러가 소유하고, 이 훅은 명시적으로 전달받은 갱신 함수만 사용한다.
 */
export function useRouteSelectFavoriteController({
  applyPlaceToTarget,
  clearSearch,
  destinationHasCoordinatesRef,
  forcedEditTarget,
  origin,
  originTouchedRef,
  originUsesDefault,
  routePointUiRevisionRef,
  setActiveTarget,
  setIsEditingRoutePoint,
  setOriginAddress,
  setOriginLat,
  setOriginLng,
  setOriginText,
  setOriginUsesDefault,
}: RouteSelectFavoriteControllerOptions) {
  const [favoritePlaces, setFavoritePlaces] = useState<FavoritePlace[]>([]);
  const [favoritePlacesLoaded, setFavoritePlacesLoaded] = useState(false);
  const [favoritePlacesError, setFavoritePlacesError] = useState<string>();
  const [favoriteReloadVersion, setFavoriteReloadVersion] = useState(0);
  const [selectedFavoriteFilterId, setSelectedFavoriteFilterId] =
    useState<string>();
  const [reduceFavoriteMotionEnabled, setReduceFavoriteMotionEnabled] =
    useState(false);
  const [favoriteSavingKey, setFavoriteSavingKey] = useState<string>();
  const [defaultOriginSavingKey, setDefaultOriginSavingKey] =
    useState<string>();
  const [favoriteSheetPlace, setFavoriteSheetPlace] = useState<Place>();
  const [favoriteSheetExisting, setFavoriteSheetExisting] = useState<FavoritePlace>();
  const [favoriteSheetLabel, setFavoriteSheetLabel] = useState("");
  const favoriteReturnFocus = useRef<(() => void) | undefined>(undefined);
  const favoriteSaveAnnouncement = useRef<string | undefined>(undefined);
  const [favoriteSaveError, setFavoriteSaveError] = useState<string>();
  const [favoriteSaveNotice, setFavoriteSaveNotice] = useState<{ message: string }>();
  const favoriteSaveInFlight = useRef(false);
  const [saveFavoriteAsDefaultOrigin, setSaveFavoriteAsDefaultOrigin] =
    useState(false);
  const [favoriteCategories, setFavoriteCategories] = useState<
    FavoritePlaceCategory[]
  >([]);
  const [favoriteCategoryLoading, setFavoriteCategoryLoading] = useState(false);
  const [favoriteCategoryError, setFavoriteCategoryError] = useState<string>();
  const categoryRequestIdRef = useRef(0);
  const [selectedFavoriteCategoryId, setSelectedFavoriteCategoryId] =
    useState<string>();
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(
    FAVORITE_CATEGORY_COLORS[0],
  );
  const [creatingFavoriteCategory, setCreatingFavoriteCategory] =
    useState(false);
  const favoritePanelEntrance = useRef(new Animated.Value(1)).current;
  const favoritePanelDirectionRef = useRef<1 | -1>(1);
  const favoriteMutationRevisionRef = useRef(0);
  const favoriteCategoryMutationRevisionRef = useRef(0);
  const favoritePlaceLoadSerialRef = useRef(0);
  const favoritePlaceLoadRequestRef = useRef<
    { id: number; reloadVersion: number } | undefined
  >(undefined);

  // 사용자의 시스템 설정을 따라 필터 전환 애니메이션을 생략할 수 있게 유지한다.
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(enabled => {
        if (active) setReduceFavoriteMotionEnabled(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      setReduceFavoriteMotionEnabled,
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  // 화면이 다시 활성화될 때 서버 목록을 갱신하되 진행 중인 로컬 변경은 병합해 보존한다.
  const navigationFocused = useIsFocused();
  const sceneActive = usePreMountedSceneActivity();
  const favoritesFocused = sceneActive ?? navigationFocused;
  useEffect(() => {
    if (!favoriteSaveNotice) return;
    const timer = setTimeout(() => setFavoriteSaveNotice(undefined), 3200);
    return () => clearTimeout(timer);
  }, [favoriteSaveNotice]);
  const loadFavoriteCategories = useCallback(async () => {
    const requestId = ++categoryRequestIdRef.current;
    const revision = favoriteCategoryMutationRevisionRef.current;
    setFavoriteCategoryLoading(true);
    try {
      const categories = await getFavoritePlaceCategoriesFromApi();
      if (requestId === categoryRequestIdRef.current) {
        setFavoriteCategoryError(undefined);
        if (revision === favoriteCategoryMutationRevisionRef.current) {
          setFavoriteCategories(categories);
        }
      }
    } catch {
      if (requestId === categoryRequestIdRef.current) {
        setFavoriteCategoryError("카테고리를 불러오지 못했어요");
      }
    } finally {
      if (requestId === categoryRequestIdRef.current) {
        setFavoriteCategoryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!favoritesFocused) return;
    let cancelled = false;
    const favoriteLoadRequest = {
      id: favoritePlaceLoadSerialRef.current + 1,
      reloadVersion: favoriteReloadVersion,
    };
    favoritePlaceLoadSerialRef.current = favoriteLoadRequest.id;
    favoritePlaceLoadRequestRef.current = favoriteLoadRequest;
    const favoriteRevision = favoriteMutationRevisionRef.current;

    setFavoritePlacesError(undefined);
    getFavoritePlacesFromApi()
      .then(favorites => {
        if (
          !cancelled &&
          favoritePlaceLoadRequestRef.current === favoriteLoadRequest
        ) {
          setFavoritePlaces(current =>
            favoriteMutationRevisionRef.current === favoriteRevision
              ? favorites
              : mergeLoadedFavoritePlaces(current, favorites),
          );
          setFavoritePlacesLoaded(true);
        }
      })
      .catch(() => {
        if (
          cancelled ||
          favoritePlaceLoadRequestRef.current !== favoriteLoadRequest
        ) {
          return;
        }
        setFavoritePlacesError("즐겨찾기를 불러오지 못했습니다.");
        setFavoritePlacesLoaded(true);
      });

    void loadFavoriteCategories();

    return () => {
      cancelled = true;
      categoryRequestIdRef.current += 1;
    };
  }, [favoriteReloadVersion, favoritesFocused, loadFavoriteCategories]);

  const favoritePlaceTabs = useMemo(
    () => buildFavoritePlaceTabs(favoritePlaces, favoriteCategories),
    [favoriteCategories, favoritePlaces],
  );

  /** 선택한 즐겨찾기 탭을 토글하고 이동 방향에 맞춰 패널 전환 애니메이션을 준비한다. */
  const toggleFavoriteFilter = useCallback(
    (tabId: string) => {
      const nextId = selectedFavoriteFilterId === tabId ? undefined : tabId;
      const currentIndex = favoritePlaceTabs.findIndex(
        tab => tab.id === selectedFavoriteFilterId,
      );
      const nextIndex = favoritePlaceTabs.findIndex(tab => tab.id === nextId);
      favoritePanelDirectionRef.current =
        nextIndex >= 0 && currentIndex >= 0 && nextIndex < currentIndex ? -1 : 1;
      favoritePanelEntrance.stopAnimation();
      favoritePanelEntrance.setValue(reduceFavoriteMotionEnabled ? 1 : 0);
      if (!reduceFavoriteMotionEnabled) configureRouteExpansionAnimation(260);
      setSelectedFavoriteFilterId(nextId);
    },
    [
      favoritePanelEntrance,
      favoritePlaceTabs,
      reduceFavoriteMotionEnabled,
      selectedFavoriteFilterId,
    ],
  );

  // 필터가 바뀌면 새 목록을 표시하고, 감소된 모션 설정에서는 즉시 완료 상태로 만든다.
  useEffect(() => {
    if (reduceFavoriteMotionEnabled) {
      favoritePanelEntrance.setValue(1);
      return;
    }
    const animation = Animated.timing(favoritePanelEntrance, {
      toValue: 1,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [
    favoritePanelEntrance,
    reduceFavoriteMotionEnabled,
    selectedFavoriteFilterId,
  ]);

  // 삭제된 카테고리를 가리키는 필터가 남지 않도록 현재 선택을 정리한다.
  useEffect(() => {
    if (
      selectedFavoriteFilterId &&
      !favoritePlaceTabs.some(tab => tab.id === selectedFavoriteFilterId)
    ) {
      setSelectedFavoriteFilterId(undefined);
    }
  }, [favoritePlaceTabs, selectedFavoriteFilterId]);

  const loadedDefaultOrigin = useMemo(
    () => favoritePlaces.find(favorite => favorite.defaultOrigin),
    [favoritePlaces],
  );

  // 서버의 기본 출발지 변경을 사용자가 아직 건드리지 않은 출발지 입력에만 반영한다.
  useEffect(() => {
    if (!favoritePlacesLoaded) return;

    if (originUsesDefault) {
      const managedDefaultSync = resolveManagedDefaultOriginSync(
        origin,
        originUsesDefault,
        loadedDefaultOrigin,
      );
      if (managedDefaultSync.kind === "clear-default-label") {
        setOriginUsesDefault(false);
      } else if (managedDefaultSync.kind === "replace") {
        setOriginText(getPlaceDisplayText(managedDefaultSync.place));
        setOriginAddress(managedDefaultSync.place.address);
        setOriginLat(managedDefaultSync.place.lat);
        setOriginLng(managedDefaultSync.place.lng);
      }
      return;
    }

    if (
      originTouchedRef.current ||
      forcedEditTarget === "origin" ||
      !placeHasCoords(loadedDefaultOrigin)
    ) {
      return;
    }

    const requestUiRevision = routePointUiRevisionRef.current;
    setOriginText(getPlaceDisplayText(loadedDefaultOrigin));
    setOriginAddress(loadedDefaultOrigin.address);
    setOriginLat(loadedDefaultOrigin.lat);
    setOriginLng(loadedDefaultOrigin.lng);
    setOriginUsesDefault(true);

    const uiUpdate = resolveDefaultOriginUiUpdate({
      requestUiRevision,
      currentUiRevision: routePointUiRevisionRef.current,
      destinationHasCoordinates: destinationHasCoordinatesRef.current,
      forcedTarget: forcedEditTarget,
    });
    if (uiUpdate) {
      setActiveTarget(uiUpdate.activeTarget);
      setIsEditingRoutePoint(uiUpdate.isEditingRoutePoint);
      clearSearch();
    }
  }, [
    clearSearch,
    destinationHasCoordinatesRef,
    favoritePlacesLoaded,
    forcedEditTarget,
    loadedDefaultOrigin,
    origin,
    originTouchedRef,
    originUsesDefault,
    routePointUiRevisionRef,
    setActiveTarget,
    setIsEditingRoutePoint,
    setOriginAddress,
    setOriginLat,
    setOriginLng,
    setOriginText,
    setOriginUsesDefault,
  ]);

  /** 좌표가 있는 장소를 즐겨찾기 저장 시트에 전달하고 이전 입력 상태를 초기화한다. */
  const openFavoriteSaveSheet = useCallback(
    (place: Place, existing?: FavoritePlace, restoreFocus?: () => void) => {
      if (!placeHasCoords(place)) {
        Alert.alert(
          "즐겨찾기 저장",
          "지도에서 위치를 확인할 수 있는 장소만 저장할 수 있어요.",
        );
        return;
      }

      Keyboard.dismiss();
      favoriteReturnFocus.current = restoreFocus;
      favoriteSaveAnnouncement.current = undefined;
      setFavoriteSheetExisting(existing);
      setFavoriteSheetLabel(getPlaceDisplayText(existing ?? place));
      setFavoriteSaveNotice(undefined);
      setFavoriteSaveError(undefined);
      setFavoriteSheetPlace(place);
      setSaveFavoriteAsDefaultOrigin(false);
      setSelectedFavoriteCategoryId(existing?.categoryId);
      setShowNewCategoryForm(false);
      setNewCategoryName("");
      setNewCategoryColor(FAVORITE_CATEGORY_COLORS[0]);
      void loadFavoriteCategories();
    },
    [loadFavoriteCategories],
  );

  /** 저장 작업이 진행 중이 아닐 때 즐겨찾기 시트를 닫고 임시 입력을 비운다. */
  const closeFavoriteSaveSheet = useCallback(() => {
    if (favoriteSaveInFlight.current || favoriteSavingKey || creatingFavoriteCategory) return;
    categoryRequestIdRef.current += 1;
    setFavoriteCategoryLoading(false);
    setFavoriteSheetPlace(undefined);
    setFavoriteSaveError(undefined);
    setSaveFavoriteAsDefaultOrigin(false);
    setFavoriteCategoryError(undefined);
    setShowNewCategoryForm(false);
    setNewCategoryName("");
  }, [creatingFavoriteCategory, favoriteSavingKey]);

  /** 입력한 이름과 색상으로 새 즐겨찾기 카테고리를 만든 뒤 즉시 선택한다. */
  const createFavoriteCategory = useCallback(async () => {
    const categoryName = newCategoryName.trim();
    if (!categoryName) {
      Alert.alert("카테고리 추가", "카테고리 이름을 입력해 주세요.");
      return;
    }
    if (isReservedFavoritePlaceCategoryName(categoryName)) {
      Alert.alert(
        "카테고리 추가",
        "기본 주소와 미분류는 기본 제공 카테고리 이름입니다.",
      );
      return;
    }

    setCreatingFavoriteCategory(true);
    try {
      const category = await createFavoritePlaceCategoryToApi(
        categoryName,
        newCategoryColor,
      );
      favoriteCategoryMutationRevisionRef.current += 1;
      setFavoriteCategories(current => {
        const next = [
          ...current.filter(item => item.id !== category.id),
          category,
        ];
        return next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      });
      setSaveFavoriteAsDefaultOrigin(false);
      setSelectedFavoriteCategoryId(category.id);
      setShowNewCategoryForm(false);
      setNewCategoryName("");
      setNewCategoryColor(FAVORITE_CATEGORY_COLORS[0]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "카테고리를 추가하지 못했습니다.";
      Alert.alert("카테고리 추가 실패", message);
    } finally {
      setCreatingFavoriteCategory(false);
    }
  }, [newCategoryColor, newCategoryName]);

  /** 장소를 선택 카테고리에 저장하고 필요하면 같은 장소를 기본 출발지로 지정한다. */
  const savePlaceAsFavorite = useCallback(
    async (place: Place, label: string, categoryId?: string, existing?: FavoritePlace) => {
      if (favoriteSaveInFlight.current) return;
      if (!placeHasCoords(place)) {
        Alert.alert(
          "즐겨찾기 저장",
          "지도에서 위치를 확인할 수 있는 장소만 저장할 수 있어요.",
        );
        return;
      }

      const savingKey = getPlaceActionKey(place);
      favoriteSaveInFlight.current = true;
      setFavoriteSaveError(undefined);
      setFavoriteSavingKey(savingKey);
      try {
        if (saveFavoriteAsDefaultOrigin) {
          const defaultOrigin = existing?.id
            ? await updateFavoritePlaceToApi(existing.id, { label, defaultOrigin: true })
            : await saveFavoriteDeparturePlace({ ...place, name: label }, { cacheBeforeSave: false });
          if (!defaultOrigin) throw new Error("기본 주소를 저장하지 못했어요.");
          favoriteMutationRevisionRef.current += 1;
          // Saving from a search row must leave the current search and route draft intact.
          originTouchedRef.current = true;
          setOriginUsesDefault(false);
          setFavoritePlaces(current =>
            upsertFavoritePlace(
              current.map(item => ({ ...item, defaultOrigin: false })),
              { ...defaultOrigin, defaultOrigin: true },
            ),
          );
        } else {
          const saved = existing?.id
            ? await updateFavoritePlaceToApi(existing.id, { label, categoryId: categoryId ?? null })
            : await saveFavoritePlaceToApi(place, { categoryId, label });
          favoriteMutationRevisionRef.current += 1;
          setFavoritePlaces(current => upsertFavoritePlace(current, saved));
        }

        setFavoriteSheetPlace(undefined);
        setSaveFavoriteAsDefaultOrigin(false);
        const message = saveFavoriteAsDefaultOrigin
          ? "기본 주소로 저장했어요"
          : existing ? "즐겨찾기를 수정했어요" : "즐겨찾기에 저장했어요";
        favoriteSaveAnnouncement.current = message;
        setFavoriteSaveNotice({ message });
      } catch {
        setFavoriteSaveError(saveFavoriteAsDefaultOrigin
          ? "기본 주소를 저장하지 못했어요. 다시 시도해 주세요."
          : "저장하지 못했어요. 다시 시도해 주세요.");
      } finally {
        favoriteSaveInFlight.current = false;
        setFavoriteSavingKey(current =>
          current === savingKey ? undefined : current,
        );
      }
    },
    [
      originTouchedRef,
      saveFavoriteAsDefaultOrigin,
      setOriginUsesDefault,
    ],
  );

  /** 저장 시트에 담긴 장소를 현재 선택 카테고리로 저장한다. */
  const saveFavoriteSheetPlace = useCallback(() => {
    const label = favoriteSheetLabel.trim();
    if (!favoriteSheetPlace || !label) return;
    void savePlaceAsFavorite(favoriteSheetPlace, label, selectedFavoriteCategoryId, favoriteSheetExisting);
  }, [favoriteSheetExisting, favoriteSheetLabel, favoriteSheetPlace, savePlaceAsFavorite, selectedFavoriteCategoryId]);

  const announceFavoriteSave = useCallback(() => {
    const restoreFocus = favoriteReturnFocus.current;
    const message = favoriteSaveAnnouncement.current;
    favoriteReturnFocus.current = undefined;
    favoriteSaveAnnouncement.current = undefined;
    if (restoreFocus || message) requestAnimationFrame(() => {
      restoreFocus?.();
      if (message) AccessibilityInfo.announceForAccessibility(message);
    });
  }, []);

  /** 중복 항목까지 함께 삭제하고 기본 출발지였다면 관련 로컬 캐시도 정리한다. */
  const removePlaceFromFavorites = useCallback(
    (favorite: FavoritePlace, actionPlace: Place = favorite) => {
      if (!favorite.id || favoriteSavingKey) return;

      const removalTargetsById = new Map<string, FavoritePlace>();
      [...findMatchingFavoritePlaces(actionPlace, favoritePlaces), favorite].forEach(
        target => {
          if (target.id) removalTargetsById.set(target.id, target);
        },
      );
      const removalTargets = [...removalTargetsById.values()];
      const removesDefaultOrigin = removalTargets.some(
        target => target.defaultOrigin,
      );

      /** 삭제 결과를 항목별로 반영해 부분 성공에서도 실제 서버 상태와 목록을 맞춘다. */
      const executeRemoval = async () => {
        const savingKey = getPlaceActionKey(actionPlace);
        setFavoriteSavingKey(savingKey);
        try {
          const results = await Promise.allSettled(
            removalTargets.map(target => deleteFavoritePlaceFromApi(target.id!)),
          );
          const deletedTargets = removalTargets.filter(
            (_, index) => results[index].status === "fulfilled",
          );
          if (deletedTargets.length === 0) {
            throw new Error("즐겨찾기를 삭제하지 못했습니다.");
          }

          if (deletedTargets.some(target => target.defaultOrigin)) {
            await clearFavoriteDeparturePlaces().catch(() => undefined);
            setOriginUsesDefault(false);
          }

          favoritePlaceLoadRequestRef.current = undefined;
          favoriteMutationRevisionRef.current += 1;
          const deletedIds = new Set(deletedTargets.map(target => target.id));
          setFavoritePlaces(current =>
            current.filter(item => !item.id || !deletedIds.has(item.id)),
          );

          if (deletedTargets.length !== removalTargets.length) {
            Alert.alert(
              "일부 즐겨찾기를 해제하지 못했어요",
              "중복 저장된 항목 일부가 남았습니다. 잠시 후 다시 시도해 주세요.",
            );
          }
        } catch {
          Alert.alert("즐겨찾기 해제 실패", "잠시 후 다시 시도해 주세요.");
        } finally {
          setFavoriteSavingKey(current =>
            current === savingKey ? undefined : current,
          );
        }
      };

      if (removesDefaultOrigin) {
        Alert.alert(
          "기본 출발지 즐겨찾기를 해제할까요?",
          "즐겨찾기에서 삭제하면 기본 출발지도 함께 해제됩니다. 현재 입력한 출발지는 그대로 유지됩니다.",
          [
            { text: "취소", style: "cancel" },
            {
              text: "해제",
              style: "destructive",
              onPress: () => {
                executeRemoval().catch(() => undefined);
              },
            },
          ],
        );
        return;
      }

      executeRemoval().catch(() => undefined);
    },
    [
      favoritePlaces,
      favoriteSavingKey,
      setOriginUsesDefault,
    ],
  );

  /** 기존 즐겨찾기를 기본 출발지로 지정하고 현재 출발지 입력에도 즉시 반영한다. */
  const setFavoriteAsDefaultOrigin = useCallback(
    async (place: FavoritePlace) => {
      const savingKey = getPlaceActionKey(place);
      setDefaultOriginSavingKey(savingKey);
      try {
        if (!place.id) {
          throw new Error("즐겨찾기 정보를 확인하지 못했어요. 다시 선택해 주세요.");
        }
        const saved = await saveFavoriteDepartureFavorite(place);
        if (!saved) {
          throw new Error("기본 출발지를 저장하지 못했어요. 다시 시도해 주세요.");
        }

        favoriteMutationRevisionRef.current += 1;
        setFavoritePlaces(current =>
          upsertFavoritePlace(
            current.map(item => ({ ...item, defaultOrigin: false })),
            { ...saved, defaultOrigin: true },
          ),
        );
        applyPlaceToTarget("origin", saved);
        setOriginUsesDefault(true);
        Alert.alert(
          "기본 출발지 설정",
          `${getPlaceDisplayText(saved)} 장소를 기본 출발지로 설정했습니다.`,
        );
      } catch {
        Alert.alert("기본 출발지 설정 실패", "잠시 후 다시 시도해 주세요.");
      } finally {
        setDefaultOriginSavingKey(current =>
          current === savingKey ? undefined : current,
        );
      }
    },
    [applyPlaceToTarget, setOriginUsesDefault],
  );

  const visibleFavoritePlaces = useMemo(
    () =>
      selectFavoritePlacesByTab(
        favoritePlaces,
        selectedFavoriteFilterId,
        favoriteCategories,
      ),
    [favoriteCategories, favoritePlaces, selectedFavoriteFilterId],
  );
  const favoritePanelAnimatedStyle = {
    opacity: favoritePanelEntrance,
    transform: [
      {
        translateX: favoritePanelEntrance.interpolate({
          inputRange: [0, 1],
          outputRange: [favoritePanelDirectionRef.current * 10, 0],
        }),
      },
      {
        translateY: favoritePanelEntrance.interpolate({
          inputRange: [0, 1],
          outputRange: [-6, 0],
        }),
      },
    ],
  };
  const hasConfiguredDefaultOrigin = placeHasCoords(loadedDefaultOrigin);
  const favoriteSheetSaving = favoriteSheetPlace
    ? favoriteSavingKey === getPlaceActionKey(favoriteSheetPlace)
    : false;

  return {
    announceFavoriteSave,
    closeFavoriteSaveSheet,
    createFavoriteCategory,
    creatingFavoriteCategory,
    defaultOriginSavingKey,
    favoriteCategories,
    favoriteCategoryError,
    favoriteCategoryLoading,
    favoritePanelAnimatedStyle,
    favoritePlaceTabs,
    favoritePlaces,
    favoritePlacesError,
    favoritePlacesLoaded,
    favoriteSaveError,
    favoriteSaveNotice,
    favoriteSavingKey,
    favoriteSheetPlace,
    favoriteSheetExisting,
    favoriteSheetLabel,
    setFavoriteSheetLabel,
    favoriteSheetSaving,
    hasConfiguredDefaultOrigin,
    loadFavoriteCategories,
    newCategoryColor,
    newCategoryName,
    openFavoriteSaveSheet,
    reduceFavoriteMotionEnabled,
    removePlaceFromFavorites,
    saveFavoriteAsDefaultOrigin,
    saveFavoriteSheetPlace,
    selectedFavoriteCategoryId,
    selectedFavoriteFilterId,
    setFavoriteAsDefaultOrigin,
    setFavoriteReloadVersion,
    setNewCategoryColor,
    setNewCategoryName,
    setSaveFavoriteAsDefaultOrigin,
    setSelectedFavoriteCategoryId,
    setShowNewCategoryForm,
    showNewCategoryForm,
    toggleFavoriteFilter,
    visibleFavoritePlaces,
  };
}

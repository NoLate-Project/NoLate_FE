import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Alert, Linking, Platform } from 'react-native';

import {
  getCurrentLocation,
  getCurrentLocationPermissionState,
} from '../../map/currentLocation';
import {
  createLatestRequestGuard,
} from '../../map/routeAsyncGuard';
import {
  reverseGeocodeToAddress,
  searchAddressByKeyword,
  type PlaceSearchItem,
} from '../../map/routingService';
import {
  getFavoriteDeparturePlace,
  hasFavoriteDepartureCoords,
  saveFavoriteDeparturePlace,
} from '../favoriteDeparture';
import { getMapPickedPlaceFallbackName } from '../routePointSelection';
import type { Place } from '../types';
import {
  placeHasCoords,
  type RoutePointTarget,
} from './params';

type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  activeTarget: RoutePointTarget | null;
  destinationLat?: number;
  destinationLng?: number;
  forcedEditTarget?: RoutePointTarget;
  hasActiveTarget: boolean;
  hasDestinationCoords: boolean;
  hasOriginCoords: boolean;
  initializedOriginRef: MutableRefObject<boolean>;
  isRoutePointLocked: boolean;
  locationPromptLoading: boolean;
  locationPromptTarget: RoutePointTarget | null;
  originAddress: string;
  originLat?: number;
  originLng?: number;
  originName: string;
  originTouchedRef: MutableRefObject<boolean>;
  routePointRequestGuardRef: MutableRefObject<ReturnType<typeof createLatestRequestGuard>>;
  searchDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  searchRequestIdRef: MutableRefObject<number>;
  setActiveTarget: SetValue<RoutePointTarget | null>;
  setCompletedSearchQuery: SetValue<string>;
  setDestinationAddress: SetValue<string>;
  setDestinationLat: SetValue<number | undefined>;
  setDestinationLng: SetValue<number | undefined>;
  setDestinationName: SetValue<string>;
  setIsRoutePointEditMode: SetValue<boolean>;
  setLocationPromptLoading: SetValue<boolean>;
  setLocationPromptTarget: SetValue<RoutePointTarget | null>;
  setOriginAddress: SetValue<string>;
  setOriginLat: SetValue<number | undefined>;
  setOriginLng: SetValue<number | undefined>;
  setOriginName: SetValue<string>;
  setOriginUsesDefault: SetValue<boolean>;
  setSearchError: SetValue<string | undefined>;
  setSearchQuery: SetValue<string>;
  setSearchResults: SetValue<PlaceSearchItem[]>;
  setSearching: SetValue<boolean>;
};

/** 앱 권한 또는 Android 위치 서비스 설정 화면을 열고 실패하면 사용자에게 복구 방법을 알린다. */
async function openDeviceLocationSettings(preferServiceSettings = false) {
  try {
    if (preferServiceSettings && Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    }
    await Linking.openSettings();
  } catch {
    Alert.alert(
      '설정을 열 수 없어요',
      '기기 설정에서 NoLate의 위치 권한을 확인해 주세요.',
    );
  }
}

/** 위치 권한 또는 위치 서비스가 꺼진 상황에 맞는 설정 이동 안내창을 표시한다. */
function showLocationSettingsAlert(
  title: string,
  message: string,
  preferServiceSettings = false,
) {
  Alert.alert(title, message, [
    { text: '취소', style: 'cancel' },
    {
      text: '설정 열기',
      onPress: () => {
        openDeviceLocationSettings(preferServiceSettings).catch(
          () => undefined,
        );
      },
    },
  ]);
}

/**
 * 출발·도착 장소 선택, 현재 위치 권한, 지도 탭, 키워드 검색 흐름을 관리한다.
 * 비동기 요청 식별자를 공유해 화면 전환 뒤 도착한 위치·검색 응답이 현재 장소를 덮지 않게 한다.
 */
export function useRoutePlannerPlaceSelection({
  activeTarget,
  destinationLat,
  destinationLng,
  forcedEditTarget,
  hasActiveTarget,
  hasDestinationCoords,
  hasOriginCoords,
  initializedOriginRef,
  isRoutePointLocked,
  locationPromptLoading,
  locationPromptTarget,
  originAddress,
  originLat,
  originLng,
  originName,
  originTouchedRef,
  routePointRequestGuardRef,
  searchDebounceRef,
  searchRequestIdRef,
  setActiveTarget,
  setCompletedSearchQuery,
  setDestinationAddress,
  setDestinationLat,
  setDestinationLng,
  setDestinationName,
  setIsRoutePointEditMode,
  setLocationPromptLoading,
  setLocationPromptTarget,
  setOriginAddress,
  setOriginLat,
  setOriginLng,
  setOriginName,
  setOriginUsesDefault,
  setSearchError,
  setSearchQuery,
  setSearchResults,
  setSearching,
}: Options) {
  const saveCurrentOriginAsFavorite = useCallback(async () => {
    const normalizedOriginName = originName.trim();
    const normalizedOriginAddress = originAddress.trim();
    const originPlace: Place = {
      name: normalizedOriginName || normalizedOriginAddress || '출발지',
      address: normalizedOriginAddress || undefined,
      lat: originLat,
      lng: originLng,
    };

    if (!placeHasCoords(originPlace)) {
      Alert.alert('즐겨찾기 저장', '좌표가 있는 출발지를 먼저 선택해 주세요.');
      return;
    }

    try {
      await saveFavoriteDeparturePlace(originPlace);
      setOriginUsesDefault(true);
      Alert.alert('기본 출발지', '현재 출발지를 기본 출발지로 저장했습니다.');
    } catch {
      Alert.alert('기본 출발지 저장 실패', '잠시 후 다시 시도해 주세요.');
    }
  }, [originAddress, originLat, originLng, originName, setOriginUsesDefault]);

  const applyPlace = (target: RoutePointTarget, place: PlaceSearchItem) => {
    routePointRequestGuardRef.current.invalidate();
    searchRequestIdRef.current += 1;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (isRoutePointLocked || !hasActiveTarget) {
      setSearchQuery('');
      setSearchResults([]);
      return;
    }

    if (target === 'origin') {
      originTouchedRef.current = true;
      setOriginUsesDefault(false);
      setOriginLat(place.lat);
      setOriginLng(place.lng);
      setOriginAddress(place.address);
      setOriginName(place.name);
      setActiveTarget('destination'); // 출발지 설정 후 도착지 탭으로 자동 전환
    } else {
      setDestinationLat(place.lat);
      setDestinationLng(place.lng);
      setDestinationAddress(place.address);
      setDestinationName(place.name);
    }

    const nextHasOrigin = target === 'origin' ? true : hasOriginCoords;
    const nextHasDestination =
      target === 'destination' ? true : hasDestinationCoords;
    if (nextHasOrigin && nextHasDestination) {
      setIsRoutePointEditMode(false);
    } else {
      setIsRoutePointEditMode(true);
    }

    setSearchQuery('');
    setSearchResults([]);
    setSearchError(undefined);
    setCompletedSearchQuery('');
    setSearching(false);
  };

  const applyCurrentLocation = useCallback(
    async (target: RoutePointTarget) => {
      const guard = routePointRequestGuardRef.current;
      const requestId = guard.begin();
      try {
        const loc = await getCurrentLocation();
        const address = await reverseGeocodeToAddress(
          loc.latitude,
          loc.longitude,
        ).catch(() => undefined);
        if (!guard.isCurrent(requestId)) return false;
        const placeName = address || '현재 위치';
        if (target === 'origin') {
          originTouchedRef.current = true;
          setOriginUsesDefault(false);
          setOriginLat(loc.latitude);
          setOriginLng(loc.longitude);
          setOriginName(placeName);
          setOriginAddress(address || '');
          setActiveTarget('destination');
        } else {
          setDestinationLat(loc.latitude);
          setDestinationLng(loc.longitude);
          setDestinationName(placeName);
          setDestinationAddress(address || '');
        }

        const nextHasOrigin = target === 'origin' ? true : hasOriginCoords;
        const nextHasDestination =
          target === 'destination' ? true : hasDestinationCoords;
        if (nextHasOrigin && nextHasDestination) {
          setIsRoutePointEditMode(false);
        } else {
          setIsRoutePointEditMode(true);
        }

        return true;
      } catch (error) {
        if (!guard.isCurrent(requestId)) return false;
        const message =
          error instanceof Error
            ? error.message
            : '현재 위치를 가져오지 못했습니다.';
        const permission = await getCurrentLocationPermissionState().catch(
          () => undefined,
        );
        if (!guard.isCurrent(requestId)) return false;
        if (permission && !permission.servicesEnabled) {
          showLocationSettingsAlert(
            '위치 서비스가 꺼져 있어요',
            '기기 위치 서비스를 켠 뒤 다시 시도해 주세요.',
            true,
          );
        } else if (
          permission &&
          !permission.granted &&
          !permission.canAskAgain
        ) {
          showLocationSettingsAlert(
            '위치 권한이 필요해요',
            '기기 설정에서 NoLate의 위치 권한을 허용한 뒤 다시 시도해 주세요.',
          );
        } else {
          Alert.alert('위치 가져오기 실패', message);
        }
        return false;
      }
    },
    [
      hasDestinationCoords,
      hasOriginCoords,
      originTouchedRef,
      routePointRequestGuardRef,
      setActiveTarget,
      setDestinationAddress,
      setDestinationLat,
      setDestinationLng,
      setDestinationName,
      setIsRoutePointEditMode,
      setOriginAddress,
      setOriginLat,
      setOriginLng,
      setOriginName,
      setOriginUsesDefault,
    ],
  );

  const requestCurrentLocation = useCallback(
    async (target: RoutePointTarget) => {
      const guard = routePointRequestGuardRef.current;
      const requestId = guard.begin();
      try {
        const permission = await getCurrentLocationPermissionState();
        if (!guard.isCurrent(requestId)) return;
        if (!permission.servicesEnabled) {
          showLocationSettingsAlert(
            '위치 서비스가 꺼져 있어요',
            '기기 위치 서비스를 켠 뒤 다시 시도해 주세요.',
            true,
          );
          return;
        }

        if (!permission.granted) {
          if (!permission.canAskAgain) {
            showLocationSettingsAlert(
              '위치 권한이 필요해요',
              '기기 설정에서 NoLate의 위치 권한을 허용한 뒤 다시 시도해 주세요.',
            );
            return;
          }
          setLocationPromptTarget(target);
          return;
        }

        await applyCurrentLocation(target);
      } catch (error) {
        if (!guard.isCurrent(requestId)) return;
        const message =
          error instanceof Error
            ? error.message
            : '현재 위치 권한 상태를 확인하지 못했습니다.';
        Alert.alert('위치 확인 실패', message);
      }
    },
    [applyCurrentLocation, routePointRequestGuardRef, setLocationPromptTarget],
  );

  const closeLocationPrompt = useCallback(() => {
    if (locationPromptLoading) return;
    routePointRequestGuardRef.current.invalidate();
    setLocationPromptTarget(null);
  }, [locationPromptLoading, routePointRequestGuardRef, setLocationPromptTarget]);

  const confirmLocationPrompt = useCallback(async () => {
    if (!locationPromptTarget || locationPromptLoading) return;
    const target = locationPromptTarget;
    setLocationPromptLoading(true);
    await applyCurrentLocation(target);
    setLocationPromptLoading(false);
    setLocationPromptTarget(null);
  }, [
    applyCurrentLocation,
    locationPromptLoading,
    locationPromptTarget,
    setLocationPromptLoading,
    setLocationPromptTarget,
  ]);

  useEffect(() => {
    if (initializedOriginRef.current) return;
    if (typeof originLat === 'number' && typeof originLng === 'number') {
      initializedOriginRef.current = true;
      return;
    }
    if (forcedEditTarget === 'origin') {
      initializedOriginRef.current = true;
      return;
    }
    initializedOriginRef.current = true;
    let cancelled = false;

    const applyStoredOriginOrCurrentLocation = async () => {
      const storedOrigin = await getFavoriteDeparturePlace().catch(() => null);
      if (cancelled || originTouchedRef.current) return;

      if (hasFavoriteDepartureCoords(storedOrigin)) {
        originTouchedRef.current = true;
        setOriginName(
          storedOrigin.name?.trim() ||
            storedOrigin.address?.trim() ||
            '기본 출발지',
        );
        setOriginAddress(storedOrigin.address?.trim() || '');
        setOriginLat(storedOrigin.lat);
        setOriginLng(storedOrigin.lng);
        setOriginUsesDefault(true);

        const hasDestination =
          typeof destinationLat === 'number' &&
          typeof destinationLng === 'number';
        if (hasDestination && !forcedEditTarget) {
          setActiveTarget(null);
          setIsRoutePointEditMode(false);
        } else {
          setActiveTarget('destination');
          setIsRoutePointEditMode(true);
        }
        return;
      }

      // 저장값이 없는 사용자만 기존 동작대로 현재 위치 권한 흐름을 사용한다.
      await requestCurrentLocation('origin');
    };

    applyStoredOriginOrCurrentLocation().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    destinationLat,
    destinationLng,
    forcedEditTarget,
    initializedOriginRef,
    originLat,
    originLng,
    originTouchedRef,
    requestCurrentLocation,
    setActiveTarget,
    setIsRoutePointEditMode,
    setOriginAddress,
    setOriginLat,
    setOriginLng,
    setOriginName,
    setOriginUsesDefault,
  ]);

  const onPressOriginTarget = () => {
    routePointRequestGuardRef.current.invalidate();
    if (activeTarget === 'origin') {
      setActiveTarget(null);
      setSearchQuery('');
      setSearchResults([]);
      return;
    }

    setActiveTarget('origin');
    setIsRoutePointEditMode(true);
    if (typeof originLat === 'number' && typeof originLng === 'number') {
      return;
    }
    originTouchedRef.current = true;
    requestCurrentLocation('origin').catch(() => {
      // ignore
    });
  };

  const onPressDestinationTarget = () => {
    routePointRequestGuardRef.current.invalidate();
    if (activeTarget === 'destination') {
      setActiveTarget(null);
      setSearchQuery('');
      setSearchResults([]);
      return;
    }

    setActiveTarget('destination');
    setIsRoutePointEditMode(true);
  };

  // onTapMap: SDK는 event.nativeEvent 없이 { latitude, longitude } 직접 전달
  const onTapMap = async (event: { latitude: number; longitude: number }) => {
    if (isRoutePointLocked || !hasActiveTarget) return;
    if (activeTarget !== 'origin' && activeTarget !== 'destination') return;
    const requestGuard = routePointRequestGuardRef.current;
    const requestId = requestGuard.begin();
    searchRequestIdRef.current += 1;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const { latitude, longitude } = event;
    const tappedTarget = activeTarget;

    if (tappedTarget === 'origin') {
      originTouchedRef.current = true;
      setOriginUsesDefault(false);
      setOriginName(getMapPickedPlaceFallbackName('origin'));
      setOriginAddress('');
      setOriginLat(latitude);
      setOriginLng(longitude);
      setActiveTarget('destination');
    } else {
      setDestinationName(getMapPickedPlaceFallbackName('destination'));
      setDestinationAddress('');
      setDestinationLat(latitude);
      setDestinationLng(longitude);
    }

    const nextHasOrigin = tappedTarget === 'origin' ? true : hasOriginCoords;
    const nextHasDestination =
      tappedTarget === 'destination' ? true : hasDestinationCoords;
    if (nextHasOrigin && nextHasDestination) {
      setIsRoutePointEditMode(false);
    } else {
      setIsRoutePointEditMode(true);
    }

    try {
      const address = await reverseGeocodeToAddress(latitude, longitude);
      if (!requestGuard.isCurrent(requestId)) return;
      if (address) {
        if (tappedTarget === 'origin') {
          setOriginName(address);
          setOriginAddress(address);
        } else {
          setDestinationName(address);
          setDestinationAddress(address);
        }
      }
    } catch {
      // 주소 역지오코딩 실패 시 좌표만 유지한다.
    }
  };

  const clearPlaceSearch = () => {
    routePointRequestGuardRef.current.invalidate();
    searchRequestIdRef.current += 1;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(undefined);
    setCompletedSearchQuery('');
    setSearching(false);
  };

  const handleSearchChange = (text: string) => {
    if (isRoutePointLocked || !hasActiveTarget) return;
    routePointRequestGuardRef.current.invalidate();
    if (activeTarget === 'origin') {
      originTouchedRef.current = true;
      setOriginUsesDefault(false);
    }
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchQuery(text);
    setSearchResults([]);
    setSearchError(undefined);
    setCompletedSearchQuery('');
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!text.trim()) {
      setSearching(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        const oppositePoint =
          activeTarget === 'origin'
            ? hasDestinationCoords &&
              typeof destinationLat === 'number' &&
              typeof destinationLng === 'number'
              ? { lat: destinationLat, lng: destinationLng }
              : undefined
            : hasOriginCoords &&
              typeof originLat === 'number' &&
              typeof originLng === 'number'
            ? { lat: originLat, lng: originLng }
            : undefined;
        const items = await searchAddressByKeyword(text.trim(), {
          center: oppositePoint,
          radiusKm: 33,
        });
        if (searchRequestIdRef.current !== requestId) return;
        setSearchResults(items);
        setCompletedSearchQuery(text.trim());
      } catch (error) {
        if (searchRequestIdRef.current !== requestId) return;
        const message =
          error instanceof Error ? error.message : '주소 검색에 실패했습니다.';
        setSearchResults([]);
        setSearchError(message);
        setCompletedSearchQuery(text.trim());
      } finally {
        if (searchRequestIdRef.current === requestId) setSearching(false);
      }
    }, 500);
  };


  return {
    applyPlace,
    clearPlaceSearch,
    closeLocationPrompt,
    confirmLocationPrompt,
    handleSearchChange,
    onPressDestinationTarget,
    onPressOriginTarget,
    onTapMap,
    saveCurrentOriginAsFavorite,
  };
}

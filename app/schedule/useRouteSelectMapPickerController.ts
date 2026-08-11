import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";

import { reverseGeocodeToAddress } from "../../src/modules/map/routingService";
import {
  createMapPickerSessionState,
  resolveMapPickerCommit,
  resolveMapPickerPostCommitTransition,
  selectMapPickerSessionCoordinate,
  type RoutePointTarget,
} from "../../src/modules/schedule/routePointSelection";
import type { Place } from "../../src/modules/schedule/types";
import {
  MAP_PICKER_FALLBACK_LAT,
  MAP_PICKER_FALLBACK_LNG,
} from "./RouteSelectAnimatedControls";
import { placeHasCoords } from "./routeSelectPlaceModel";

type RouteSelectMapPickerControllerOptions = {
  activeTarget: RoutePointTarget;
  applyPlaceToTarget: (target: RoutePointTarget, place: Place) => void;
  destination?: Place;
  destinationLat?: number;
  destinationLng?: number;
  onOpenMapPicker: () => void;
  origin?: Place;
  originLat?: number;
  originLng?: number;
  rememberRecentPlace: (place: Place) => void;
};

/**
 * 출발지·도착지 지도 선택 모달의 카메라 위치, 선택 좌표와 역지오코딩 요청을 관리한다.
 * 선택 확정 시 다음 빈 지점으로 이어갈지 모달을 닫을지도 이 훅에서 일관되게 결정한다.
 */
export function useRouteSelectMapPickerController({
  activeTarget,
  applyPlaceToTarget,
  destination,
  destinationLat,
  destinationLng,
  onOpenMapPicker,
  origin,
  originLat,
  originLng,
  rememberRecentPlace,
}: RouteSelectMapPickerControllerOptions) {
  const [mapPickerVisible, setMapPickerVisible] = useState(false);
  const [mapPickerSession, setMapPickerSession] = useState(
    createMapPickerSessionState,
  );
  const mapPickerCoord = mapPickerSession.pickedCoordinate;
  const mapPickerHasSelection = mapPickerSession.hasSelection;
  const [mapPickerName, setMapPickerName] = useState<string>();
  const [mapPickerAddress, setMapPickerAddress] = useState<string>();
  const [mapPickerResolving, setMapPickerResolving] = useState(false);
  const mapPickerRequestIdRef = useRef(0);

  /** 대상 지점, 반대편 지점, 기본 좌표 순서로 지도 모달의 최초 카메라 위치를 고른다. */
  const getMapPickerInitialCoord = useCallback(
    (target: RoutePointTarget) => {
      const targetLat = target === "origin" ? originLat : destinationLat;
      const targetLng = target === "origin" ? originLng : destinationLng;
      if (typeof targetLat === "number" && typeof targetLng === "number") {
        return { latitude: targetLat, longitude: targetLng };
      }

      const pairedLat = target === "origin" ? destinationLat : originLat;
      const pairedLng = target === "origin" ? destinationLng : originLng;
      if (typeof pairedLat === "number" && typeof pairedLng === "number") {
        return { latitude: pairedLat, longitude: pairedLng };
      }

      return {
        latitude: MAP_PICKER_FALLBACK_LAT,
        longitude: MAP_PICKER_FALLBACK_LNG,
      };
    },
    [destinationLat, destinationLng, originLat, originLng],
  );

  /** 현재 편집 대상과 기존 좌표를 기준으로 지도 선택 세션을 만들고 모달을 연다. */
  const openMapForPointSelection = useCallback(() => {
    onOpenMapPicker();
    const targetPlace = activeTarget === "origin" ? origin : destination;
    const targetHasCoordinates = placeHasCoords(targetPlace);
    const initialCoord = getMapPickerInitialCoord(activeTarget);
    setMapPickerSession(
      createMapPickerSessionState(initialCoord, targetHasCoordinates),
    );
    setMapPickerName(targetHasCoordinates ? targetPlace.name : undefined);
    setMapPickerAddress(targetHasCoordinates ? targetPlace.address : undefined);
    setMapPickerVisible(true);
  }, [
    activeTarget,
    destination,
    getMapPickerInitialCoord,
    onOpenMapPicker,
    origin,
  ]);

  /** 진행 중인 주소 확인 요청을 무효화하고 지도 선택 모달의 임시 상태를 비운다. */
  const closeMapPicker = useCallback(() => {
    mapPickerRequestIdRef.current += 1;
    setMapPickerVisible(false);
    setMapPickerSession(current =>
      createMapPickerSessionState(current.cameraCoordinate),
    );
    setMapPickerName(undefined);
    setMapPickerAddress(undefined);
    setMapPickerResolving(false);
  }, []);

  /** 사용자가 누른 좌표를 세션에 기록하고 최신 요청에 한해 사람이 읽을 수 있는 주소를 반영한다. */
  const selectMapPickerCoord = useCallback(
    async ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      const requestId = mapPickerRequestIdRef.current + 1;
      mapPickerRequestIdRef.current = requestId;
      setMapPickerSession(current =>
        selectMapPickerSessionCoordinate(current, { latitude, longitude }),
      );
      setMapPickerName(undefined);
      setMapPickerAddress(undefined);
      setMapPickerResolving(true);
      try {
        const address = await reverseGeocodeToAddress(latitude, longitude);
        if (mapPickerRequestIdRef.current !== requestId) return;
        setMapPickerAddress(address);
      } catch {
        if (mapPickerRequestIdRef.current !== requestId) return;
        setMapPickerAddress(undefined);
      } finally {
        if (mapPickerRequestIdRef.current === requestId) {
          setMapPickerResolving(false);
        }
      }
    },
    [],
  );

  /** 선택 좌표를 장소로 확정하고, 남은 지점이 있으면 같은 모달에서 다음 선택을 이어간다. */
  const confirmMapPickerSelection = useCallback(
    (target: RoutePointTarget) => {
      const commit = resolveMapPickerCommit(
        mapPickerSession,
        target,
        mapPickerResolving,
      );
      if (!commit) {
        if (mapPickerResolving) {
          Alert.alert(
            "주소 확인 중",
            "선택한 위치의 주소를 확인한 뒤 다시 시도해 주세요.",
          );
          return;
        }
        Alert.alert("위치 선택 필요", "지도에서 위치를 선택해 주세요.");
        return;
      }

      const label =
        target === "origin" ? "지도 선택 출발지" : "지도 선택 도착지";
      const place: Place = {
        name: mapPickerName || mapPickerAddress || label,
        address: mapPickerAddress,
        lat: commit.coordinate.latitude,
        lng: commit.coordinate.longitude,
      };
      const transition = resolveMapPickerPostCommitTransition(
        mapPickerSession,
        commit.target,
        typeof originLat === "number" && typeof originLng === "number",
        typeof destinationLat === "number" && typeof destinationLng === "number",
      );

      mapPickerRequestIdRef.current += 1;
      rememberRecentPlace(place);
      applyPlaceToTarget(commit.target, place);
      setMapPickerResolving(false);
      if (transition.keepPickerOpen) {
        setMapPickerSession(transition.nextSession);
        setMapPickerName(undefined);
        setMapPickerAddress(undefined);
        return;
      }
      setMapPickerVisible(false);
    },
    [
      applyPlaceToTarget,
      destinationLat,
      destinationLng,
      mapPickerAddress,
      mapPickerName,
      mapPickerResolving,
      mapPickerSession,
      originLat,
      originLng,
      rememberRecentPlace,
    ],
  );

  return {
    closeMapPicker,
    confirmMapPickerSelection,
    mapPickerAddress,
    mapPickerCoord,
    mapPickerHasSelection,
    mapPickerName,
    mapPickerResolving,
    mapPickerSession,
    mapPickerVisible,
    openMapForPointSelection,
    selectMapPickerCoord,
  };
}

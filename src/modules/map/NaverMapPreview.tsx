import React from "react";
import { View } from "react-native";
import TmapMapView from "./TmapMapView";
import { useTheme } from "../theme/ThemeContext";

// 위치 선택 모달에서 쓰는 경량 지도 미리보기.
// 이름은 호환성 때문에 NaverMapPreview지만 렌더러는 TmapMapView를 사용한다.
type Props = {
    lat?: number;
    lng?: number;
    height?: number;
};

const FALLBACK_LAT = 37.5665;
const FALLBACK_LNG = 126.978;

export default function NaverMapPreview({ lat, lng, height = 180 }: Props) {
    const { colors, mode } = useTheme();
    // 좌표가 없을 때는 서울 시청 근처를 기준점으로 사용한다.
    const centerLat = typeof lat === "number" ? lat : FALLBACK_LAT;
    const centerLng = typeof lng === "number" ? lng : FALLBACK_LNG;
    const isDark = mode === "dark";

    return (
        <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
            <TmapMapView
                style={{ flex: 1 }}
                camera={{ latitude: centerLat, longitude: centerLng, zoom: 14 }}
                // 미리보기 지도도 앱 테마(light/dark)를 그대로 따른다.
                nightModeEnabled={isDark}
                markers={[{
                    id: "preview-marker",
                    latitude: centerLat,
                    longitude: centerLng,
                    tintColor: "#1D72FF",
                }]}
                showLocationButton={false}
                showZoomControls={false}
                fallbackBackgroundColor={colors.surface2}
                fallbackTextColor={colors.textSecondary}
            />
        </View>
    );
}

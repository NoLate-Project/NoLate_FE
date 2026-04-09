import React from "react";
import { View } from "react-native";
import TmapMapView from "./TmapMapView";
import { useTheme } from "../theme/ThemeContext";

// 위치 선택 모달 안에서 사용하는 경량 지도 미리보기다.
// 컴포넌트 이름은 예전 호환 때문에 NaverMapPreview지만 실제 렌더러는 TmapMapView다.
type Props = {
    lat?: number;
    lng?: number;
    height?: number;
};

const FALLBACK_LAT = 37.5665;
const FALLBACK_LNG = 126.978;

export default function NaverMapPreview({ lat, lng, height = 180 }: Props) {
    const { colors, mode } = useTheme();
    const centerLat = typeof lat === "number" ? lat : FALLBACK_LAT;
    const centerLng = typeof lng === "number" ? lng : FALLBACK_LNG;
    const isDark = mode === "dark";

    return (
        <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
            <TmapMapView
                style={{ flex: 1 }}
                camera={{ latitude: centerLat, longitude: centerLng, zoom: 14 }}
                // 미리보기 지도도 화면 전체와 같은 ThemeContext를 따라가야 한다.
                // 이 값을 생략하면 TmapMapView 기본값(false)이 적용되어,
                // 주변 UI가 dark mode로 바뀌어도 이 지도만 계속 라이트로 남는다.
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

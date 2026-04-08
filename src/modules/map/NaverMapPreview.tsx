import React from "react";
import { View } from "react-native";
import TmapMapView from "./TmapMapView";

// 폼/모달 안에서 쓰는 경량 지도 미리보기.
// 이름은 예전 호환 때문에 NaverMapPreview지만 실제 렌더러는 TmapMapView를 사용한다.
type Props = {
    lat?: number;
    lng?: number;
    height?: number;
};

const FALLBACK_LAT = 37.5665;
const FALLBACK_LNG = 126.978;

export default function NaverMapPreview({ lat, lng, height = 180 }: Props) {
    // 좌표가 없을 때도 빈 박스 대신 서울 중심 fallback 지도를 보여 준다.
    const centerLat = typeof lat === "number" ? lat : FALLBACK_LAT;
    const centerLng = typeof lng === "number" ? lng : FALLBACK_LNG;

    return (
        <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
            <TmapMapView
                style={{ flex: 1 }}
                camera={{ latitude: centerLat, longitude: centerLng, zoom: 14 }}
                markers={[{
                    id: "preview-marker",
                    latitude: centerLat,
                    longitude: centerLng,
                    tintColor: "#1D72FF",
                }]}
                showLocationButton={false}
                showZoomControls={false}
            />
        </View>
    );
}

import React from "react";
import { View } from "react-native";
import TmapMapView from "./TmapMapView";

type Props = {
    lat?: number;
    lng?: number;
    height?: number;
};

const FALLBACK_LAT = 37.5665;
const FALLBACK_LNG = 126.978;

export default function NaverMapPreview({ lat, lng, height = 180 }: Props) {
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

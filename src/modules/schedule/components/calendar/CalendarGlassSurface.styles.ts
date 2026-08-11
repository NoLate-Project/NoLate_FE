import { StyleSheet } from "react-native";

/** CalendarGlassSurface 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    surface: {
        position: "relative",
    },
    clipped: {
        overflow: "hidden",
    },
    menuLiquidSurfaceDark: {
        backgroundColor: "rgba(8, 9, 14, 0.79)",
    },
    menuLiquidSurfaceLight: {
        backgroundColor: "rgba(255, 255, 255, 0.79)",
    },
    solidCardSurfaceDark: {
        backgroundColor: "rgba(9, 10, 13, 0.96)",
    },
    solidCardSurfaceLight: {
        backgroundColor: "rgba(255, 255, 255, 0.84)",
    },
    innerStroke: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.20)",
    },
    topHighlight: {
        borderTopWidth: StyleSheet.hairlineWidth,
        opacity: 0.74,
    },
    topHighlightFlat: {
        opacity: 0.18,
    },
    topHighlightSoftGlass: {
        opacity: 0.34,
    },
    topHighlightMenuLiquid: {
        opacity: 0.27,
    },
    topHighlightSolidCard: {
        opacity: 0.22,
    },
    glow: {
        opacity: 0.65,
    },
    contrastLayer: {
        opacity: 0.83,
    },
    contrastLayerFlat: {
        opacity: 0.28,
    },
    contrastLayerSoftGlass: {
        opacity: 0.41,
    },
    contrastLayerMenuLiquid: {
        opacity: 0.86,
    },
    sheenLayer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "42%",
        opacity: 0.65,
    },
    sheenLayerSoftGlass: {
        height: "26%",
        opacity: 0.18,
    },
    prominentFill: {
        opacity: 0.81,
    },
    prominentFillFlat: {
        opacity: 0.48,
    },
    prominentFillSoftGlass: {
        opacity: 0.56,
    },
    prominentFillMenuLiquid: {
        opacity: 0.86,
    },
    prominentFillDark: {
        backgroundColor: "rgba(14,15,18,0.76)",
    },
    prominentFillLight: {
        backgroundColor: "rgba(255,255,255,0.82)",
    },
    fallbackDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 12,
    },
    nativeDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 7 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
    },
    bottomBarDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.13,
        shadowRadius: 18,
        elevation: 16,
    },
    mapDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.30,
        shadowRadius: 30,
        elevation: 24,
    },
    androidDepth: {
        elevation: 14,
    },
});

export default styles;

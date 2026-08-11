import { StyleSheet } from "react-native";

import baseStyles from "./routeSelectStyles/base";
import favoritesStyles from "./routeSelectStyles/favorites";
import filtersStyles from "./routeSelectStyles/filters";
import routeOptionsStyles from "./routeSelectStyles/routeOptions";
import mapPickerStyles from "./routeSelectStyles/mapPicker";

/** 기능 영역별 스타일을 경로 선택 화면이 사용하는 단일 registry로 결합합니다. */
const styles = StyleSheet.create({
    ...baseStyles,
    ...favoritesStyles,
    ...filtersStyles,
    ...routeOptionsStyles,
    ...mapPickerStyles,
});

export default styles;

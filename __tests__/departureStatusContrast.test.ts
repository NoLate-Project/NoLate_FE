import {
    getColorContrastRatio,
    LIGHT_DEPARTURE_BADGE_COLORS,
} from "../src/ui/colorContrast";

test("light theme 9px badge의 주황/초록/파랑 text는 4.5:1 이상이다", () => {
    expect(getColorContrastRatio(
        LIGHT_DEPARTURE_BADGE_COLORS.attentionText,
        LIGHT_DEPARTURE_BADGE_COLORS.attentionBackground,
    )).toBeGreaterThanOrEqual(4.5);
    expect(getColorContrastRatio(
        LIGHT_DEPARTURE_BADGE_COLORS.freshText,
        LIGHT_DEPARTURE_BADGE_COLORS.freshBackground,
    )).toBeGreaterThanOrEqual(4.5);
    expect(getColorContrastRatio(
        LIGHT_DEPARTURE_BADGE_COLORS.infoText,
        LIGHT_DEPARTURE_BADGE_COLORS.infoBackground,
    )).toBeGreaterThanOrEqual(4.5);
});

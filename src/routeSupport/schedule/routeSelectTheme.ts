type RouteSelectThemeColors = {
  background: string;
  inputBackground: string;
  inputBorder: string;
  inputPlaceholder: string;
};

/**
 * 앱 테마 색상을 경로 선택 화면의 의미 기반 색상 토큰으로 변환한다.
 * 각 화면 조각은 다크 모드 분기를 반복하지 않고 반환된 토큰만 사용한다.
 */
export function buildRouteSelectTheme(
  isDark: boolean,
  colors: RouteSelectThemeColors,
) {
  return isDark
    ? {
        background: "#0F1117",
        surface: "#171A20",
        surface2: "#23262D",
        selectedSurface: "#171A20",
        selectedBorder: "rgba(47,140,255,0.72)",
        selectedModeBg: "rgba(41,121,255,0.13)",
        neutralChipBg: "rgba(255,255,255,0.025)",
        neutralChipBorder: "rgba(255,255,255,0.10)",
        border: "#2A2F3A",
        borderStrong: "#474950",
        textPrimary: "#F5F7FA",
        textSecondary: "#9CA3AF",
        textDisabled: "#6B7280",
        inputBackground: "#0B0D12",
        inputBorder: "#2A2F3A",
        inputBorderFocused: "#2979FF",
        inputPlaceholder: "#6B7280",
        clearButtonBg: "#474950",
        clearButtonText: "#FFFFFF",
        accentBlue: "#2979FF",
        accentGreen: "#22C55E",
        accentRed: "#FF4444",
      }
    : {
        background: colors.background,
        surface: "#FFFFFF",
        surface2: "#F2F4F8",
        selectedSurface: "#FFFFFF",
        selectedBorder: "rgba(30,104,255,0.72)",
        selectedModeBg: "rgba(41,121,255,0.10)",
        neutralChipBg: "#F8FAFC",
        neutralChipBorder: "#E2E8F0",
        border: "#E2E8F0",
        borderStrong: "#CBD5E1",
        textPrimary: "#111827",
        textSecondary: "#667085",
        textDisabled: "#98A2B3",
        inputBackground: colors.inputBackground,
        inputBorder: colors.inputBorder,
        inputBorderFocused: "#2979FF",
        inputPlaceholder: colors.inputPlaceholder,
        clearButtonBg: "#E5E7EB",
        clearButtonText: "#111827",
        accentBlue: "#1E68FF",
        accentGreen: "#16A34A",
        accentRed: "#EF4444",
      };
}

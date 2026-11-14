import type { ImageSourcePropType } from "react-native";

export type ProductTourStep = {
    id: "quick" | "departure";
    title: string;
    description: string;
    images: Readonly<Record<"light" | "dark", ImageSourcePropType>>;
    inputImages?: Readonly<Record<"light" | "dark", ImageSourcePropType>>;
    accessibilityLabel: string;
};

/** 큐레이션 이후 실제 화면으로 보여주는 NoLate의 핵심 사용 흐름입니다. */
export const PRODUCT_TOUR_STEPS: readonly ProductTourStep[] = [
    {
        id: "quick",
        title: "빠른 일정으로 등록해요",
        description: "텍스트 붙여넣기, 사진, 음성 중 하나로 입력해요. 미리보기에서 날짜와 장소를 확인한 뒤 저장하세요.",
        images: {
            light: require("../../../assets/onboarding/quick-schedule-light.png"),
            dark: require("../../../assets/onboarding/quick-schedule-dark.png"),
        },
        inputImages: {
            light: require("../../../assets/onboarding/quick-input-light.png"),
            dark: require("../../../assets/onboarding/quick-input-dark.png"),
        },
        accessibilityLabel: "텍스트, 사진, 음성으로 빠른 일정을 입력하고 일정 미리보기로 확인하는 과정",
    },
    {
        id: "departure",
        title: "출발 시간을 확인해요",
        description: "장소와 경로를 등록한 일정의 상세 화면을 열어 보세요. 지도 아래에서 추천 출발 시각과 이동 경로를 확인할 수 있어요.",
        images: {
            light: require("../../../assets/onboarding/departure-light.png"),
            dark: require("../../../assets/onboarding/departure-dark.png"),
        },
        accessibilityLabel: "서울역에서 강남역까지의 경로와 오전 11시 24분 권장 출발 시각을 보여주는 화면",
    },
] as const;

export function getProductTourButtonLabel(stepIndex: number): string {
    return stepIndex >= PRODUCT_TOUR_STEPS.length - 1 ? "NoLate 시작하기" : "출발 시간 확인하기";
}

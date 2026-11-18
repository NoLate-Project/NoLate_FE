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
        title: "약속 내용을 일정으로 바꿔요",
        description: "빠른 일정에 약속 내용을 넣고, 날짜와 장소를 확인한 뒤 저장해요.",
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
        title: "출발할 시간을 바로 확인해요",
        description: "경로를 등록한 일정은 상세 화면의 지도 아래에서 출발 시각을 확인할 수 있어요.",
        images: {
            light: require("../../../assets/onboarding/departure-light.png"),
            dark: require("../../../assets/onboarding/departure-dark.png"),
        },
        accessibilityLabel: "서울역에서 강남역까지의 경로와 오전 11시 24분 권장 출발 시각을 보여주는 화면",
    },
] as const;

export function getProductTourButtonLabel(stepIndex: number): string {
    return stepIndex >= PRODUCT_TOUR_STEPS.length - 1 ? "NoLate 시작하기" : "출발 준비 보기";
}

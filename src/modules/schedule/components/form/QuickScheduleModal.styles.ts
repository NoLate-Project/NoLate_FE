import { createShellInputStyles } from "./quickScheduleModalStyles/shellInput";
import { createPhotoStyles } from "./quickScheduleModalStyles/photo";
import { createVoiceStyles } from "./quickScheduleModalStyles/voice";
import { createPreviewStyles } from "./quickScheduleModalStyles/preview";
import { createEditStyles } from "./quickScheduleModalStyles/edit";
import { createNotificationStyles } from "./quickScheduleModalStyles/notification";
import { createActionsStyles } from "./quickScheduleModalStyles/actions";

export type QuickScheduleModalStylesOptions = {
    BLUE: string;
    EXPANDED_CARD_RADIUS: number;
    VOICE_SPECTRUM_INNER_RADIUS: number;
    VOICE_SPECTRUM_SIZE: number;
};

/** 기능 영역별 스타일을 결합해 화면에서 사용하는 단일 registry를 생성합니다. */
export function createQuickScheduleModalStyles(options: QuickScheduleModalStylesOptions) {
    return {
        ...createShellInputStyles(options),
        ...createPhotoStyles(options),
        ...createVoiceStyles(options),
        ...createPreviewStyles(options),
        ...createEditStyles(options),
        ...createNotificationStyles(options),
        ...createActionsStyles(options),
    };
}

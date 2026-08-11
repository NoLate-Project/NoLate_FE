import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { ActionSheetIOS, Alert, Keyboard, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { ImagePickerAsset } from "expo-image-picker";

import {
  runAfterInteraction,
  type InputMode,
} from "./quickScheduleModalModel";

type QuickSchedulePhotoActionsOptions = {
  closingRef: MutableRefObject<boolean>;
  mode: string;
  mountedRef: MutableRefObject<boolean>;
  selectPhotoForRecognition: (asset: ImagePickerAsset | null) => void;
  setInputMode: Dispatch<SetStateAction<InputMode>>;
  stopActiveRecording: (preserveRecording?: boolean) => Promise<string | null>;
  submitting: boolean;
  visibleRef: MutableRefObject<boolean>;
};

/** 사진 촬영·보관함 선택과 네이티브 액션 시트의 수명 주기를 관리한다. */
export function useQuickSchedulePhotoActions({
  closingRef,
  mode,
  mountedRef,
  selectPhotoForRecognition,
  setInputMode,
  stopActiveRecording,
  submitting,
  visibleRef,
}: QuickSchedulePhotoActionsOptions) {
  const photoSourceOperationRef = useRef(0);
  const pendingPhotoActionCancelRef = useRef<(() => void) | null>(null);

  /** 대기 중인 네이티브 사진 작업 예약을 취소한다. */
  const cancelPendingPhotoAction = useCallback(() => {
    pendingPhotoActionCancelRef.current?.();
    pendingPhotoActionCancelRef.current = null;
  }, []);

  /** 이전 사진 소스 작업을 무효화하고 예약된 실행도 함께 취소한다. */
  const invalidatePhotoSource = useCallback(() => {
    photoSourceOperationRef.current += 1;
    cancelPendingPhotoAction();
  }, [cancelPendingPhotoAction]);

  useEffect(() => invalidatePhotoSource, [invalidatePhotoSource]);

  /** 사진 보관함 권한을 확인한 뒤 원본 품질의 단일 사진을 선택한다. */
  const pickPhotoFromLibrary = useCallback(async () => {
    if (
      submitting ||
      !mountedRef.current ||
      !visibleRef.current ||
      closingRef.current
    ) {
      return;
    }

    const operation = photoSourceOperationRef.current + 1;
    photoSourceOperationRef.current = operation;
    Keyboard.dismiss();
    await stopActiveRecording();
    if (
      photoSourceOperationRef.current !== operation ||
      !mountedRef.current ||
      !visibleRef.current ||
      closingRef.current
    ) {
      return;
    }
    setInputMode("photo");

    try {
      if (Platform.OS !== "ios") {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            "사진 권한 필요",
            "사진으로 빠른 일정을 만들려면 사진 보관함 권한이 필요합니다.",
          );
          return;
        }
      }
      if (
        photoSourceOperationRef.current !== operation ||
        !mountedRef.current ||
        !visibleRef.current ||
        closingRef.current
      ) {
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });
      if (
        photoSourceOperationRef.current === operation &&
        mountedRef.current &&
        visibleRef.current &&
        !closingRef.current &&
        !result.canceled
      ) {
        selectPhotoForRecognition(result.assets[0] ?? null);
      }
    } catch (error) {
      if (
        photoSourceOperationRef.current !== operation ||
        !mountedRef.current ||
        !visibleRef.current ||
        closingRef.current
      ) {
        return;
      }
      Alert.alert(
        "사진 선택 실패",
        error instanceof Error ? error.message : "사진을 불러오지 못했습니다.",
      );
    }
  }, [
    closingRef,
    mountedRef,
    selectPhotoForRecognition,
    setInputMode,
    stopActiveRecording,
    submitting,
    visibleRef,
  ]);

  /** 카메라 권한을 확인한 뒤 OCR에 사용할 원본 품질 사진을 촬영한다. */
  const capturePhoto = useCallback(async () => {
    if (
      submitting ||
      !mountedRef.current ||
      !visibleRef.current ||
      closingRef.current
    ) {
      return;
    }
    const operation = photoSourceOperationRef.current + 1;
    photoSourceOperationRef.current = operation;
    Keyboard.dismiss();
    await stopActiveRecording();
    if (
      photoSourceOperationRef.current !== operation ||
      !mountedRef.current ||
      !visibleRef.current ||
      closingRef.current
    ) {
      return;
    }
    setInputMode("photo");

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "카메라 권한 필요",
          "사진을 촬영해 빠른 일정을 만들려면 카메라 권한이 필요합니다.",
        );
        return;
      }
      if (
        photoSourceOperationRef.current !== operation ||
        !mountedRef.current ||
        !visibleRef.current ||
        closingRef.current
      ) {
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
      if (
        photoSourceOperationRef.current === operation &&
        mountedRef.current &&
        visibleRef.current &&
        !closingRef.current &&
        !result.canceled
      ) {
        selectPhotoForRecognition(result.assets[0] ?? null);
      }
    } catch (error) {
      if (
        photoSourceOperationRef.current !== operation ||
        !mountedRef.current ||
        !visibleRef.current ||
        closingRef.current
      ) {
        return;
      }
      Alert.alert(
        "촬영 실패",
        error instanceof Error ? error.message : "카메라를 열지 못했습니다.",
      );
    }
  }, [
    closingRef,
    mountedRef,
    selectPhotoForRecognition,
    setInputMode,
    stopActiveRecording,
    submitting,
    visibleRef,
  ]);

  /** 사진 탭 전환 전에 대기 작업·키보드·음성 녹음을 정리한다. */
  const activatePhotoMode = useCallback(() => {
    if (submitting) return;
    cancelPendingPhotoAction();
    Keyboard.dismiss();
    stopActiveRecording().catch(() => undefined);
    setInputMode("photo");
  }, [
    cancelPendingPhotoAction,
    setInputMode,
    stopActiveRecording,
    submitting,
  ]);

  /** 네이티브 시트가 닫힌 뒤에도 같은 작업 세션일 때만 사진 동작을 실행한다. */
  const schedulePhotoAction = useCallback(
    (expectedSourceOperation: number, action: () => void) => {
      cancelPendingPhotoAction();
      pendingPhotoActionCancelRef.current = runAfterInteraction(() => {
        pendingPhotoActionCancelRef.current = null;
        if (
          photoSourceOperationRef.current !== expectedSourceOperation ||
          !mountedRef.current ||
          !visibleRef.current ||
          closingRef.current
        ) {
          return;
        }
        action();
      });
    },
    [cancelPendingPhotoAction, closingRef, mountedRef, visibleRef],
  );

  /** 플랫폼에 맞는 촬영·보관함 선택 메뉴를 열고 선택 동작을 안전하게 예약한다. */
  const openPhotoActionSheet = useCallback(async () => {
    if (
      submitting ||
      !mountedRef.current ||
      !visibleRef.current ||
      closingRef.current
    ) {
      return;
    }
    const operation = photoSourceOperationRef.current + 1;
    photoSourceOperationRef.current = operation;
    cancelPendingPhotoAction();
    Keyboard.dismiss();
    await stopActiveRecording();
    if (
      photoSourceOperationRef.current !== operation ||
      !mountedRef.current ||
      !visibleRef.current ||
      closingRef.current
    ) {
      return;
    }
    setInputMode("photo");

    if (Platform.OS === "ios") {
      const options = ["사진 찍기", "사진 앱에서 선택", "취소"];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "사진으로 일정 만들기",
          options,
          cancelButtonIndex: options.length - 1,
          userInterfaceStyle: mode === "dark" ? "dark" : "light",
        },
        buttonIndex => {
          if (
            photoSourceOperationRef.current !== operation ||
            !mountedRef.current ||
            !visibleRef.current ||
            closingRef.current
          ) {
            return;
          }
          if (buttonIndex === 0) {
            schedulePhotoAction(operation, () => {
              capturePhoto().catch(() => undefined);
            });
          }
          if (buttonIndex === 1) {
            schedulePhotoAction(operation, () => {
              pickPhotoFromLibrary().catch(() => undefined);
            });
          }
        },
      );
      return;
    }

    Alert.alert("사진으로 일정 만들기", undefined, [
      {
        text: "사진 찍기",
        onPress: () =>
          schedulePhotoAction(operation, () => {
            capturePhoto().catch(() => undefined);
          }),
      },
      {
        text: "사진 앱에서 선택",
        onPress: () =>
          schedulePhotoAction(operation, () => {
            pickPhotoFromLibrary().catch(() => undefined);
          }),
      },
      { text: "취소", style: "cancel" },
    ]);
  }, [
    cancelPendingPhotoAction,
    capturePhoto,
    closingRef,
    mode,
    mountedRef,
    pickPhotoFromLibrary,
    schedulePhotoAction,
    setInputMode,
    stopActiveRecording,
    submitting,
    visibleRef,
  ]);

  return {
    activatePhotoMode,
    cancelPendingPhotoAction,
    invalidatePhotoSource,
    openPhotoActionSheet,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImagePickerAsset } from "expo-image-picker";

import {
  cancelQuickSchedulePhotoRecognition,
  recognizeQuickSchedulePhoto,
} from "../../quickInputExtraction";
import {
  PHOTO_RECOGNITION_TIMEOUT_MILLIS,
  limitRecognizedText,
} from "./quickScheduleModalModel";

/**
 * 선택한 사진의 OCR 요청과 결과 상태를 관리한다.
 * 사진이 바뀌거나 훅이 정리되면 이전 요청을 취소하고 최신 요청 결과만 반영한다.
 */
export function useQuickSchedulePhotoRecognition() {
  const [selectedPhoto, setSelectedPhoto] =
    useState<ImagePickerAsset | null>(null);
  const [photoTranscript, setPhotoTranscript] = useState("");
  const [photoTranscriptTruncated, setPhotoTranscriptTruncated] =
    useState(false);
  const [photoRecognitionConfidence, setPhotoRecognitionConfidence] =
    useState<number>();
  const [photoRecognitionError, setPhotoRecognitionError] = useState("");
  const [photoRecognitionAttempt, setPhotoRecognitionAttempt] = useState(0);
  const [isPhotoRecognizing, setIsPhotoRecognizing] = useState(false);
  const photoRecognitionSequenceRef = useRef(0);

  useEffect(() => {
    const photoUri = selectedPhoto?.uri;
    const sequence = photoRecognitionSequenceRef.current + 1;
    photoRecognitionSequenceRef.current = sequence;

    if (!photoUri) {
      setPhotoTranscript("");
      setPhotoTranscriptTruncated(false);
      setPhotoRecognitionConfidence(undefined);
      setPhotoRecognitionError("");
      setIsPhotoRecognizing(false);
      return undefined;
    }

    setPhotoTranscript("");
    setPhotoTranscriptTruncated(false);
    setPhotoRecognitionConfidence(undefined);
    setPhotoRecognitionError("");
    setIsPhotoRecognizing(true);
    const requestId = `quick-photo-${Date.now()}-${sequence}`;
    let completed = false;
    const timeout = setTimeout(() => {
      if (photoRecognitionSequenceRef.current !== sequence) return;
      photoRecognitionSequenceRef.current += 1;
      cancelQuickSchedulePhotoRecognition(requestId).catch(() => undefined);
      setIsPhotoRecognizing(false);
      setPhotoRecognitionError(
        "사진을 읽는 데 시간이 오래 걸려 중단했어요. 다시 읽거나 아래에 직접 입력해 주세요.",
      );
    }, PHOTO_RECOGNITION_TIMEOUT_MILLIS);

    recognizeQuickSchedulePhoto(photoUri, requestId)
      .then(recognition => {
        if (photoRecognitionSequenceRef.current !== sequence) return;
        const limited = limitRecognizedText(recognition.text);
        setPhotoTranscript(limited.text);
        setPhotoTranscriptTruncated(
          limited.truncated || recognition.truncated === true,
        );
        setPhotoRecognitionConfidence(recognition.recognitionConfidence);
      })
      .catch(error => {
        if (photoRecognitionSequenceRef.current !== sequence) return;
        setPhotoRecognitionError(
          error instanceof Error
            ? error.message
            : "사진에서 일정 내용을 찾지 못했어요.",
        );
      })
      .finally(() => {
        completed = true;
        clearTimeout(timeout);
        if (photoRecognitionSequenceRef.current === sequence) {
          setIsPhotoRecognizing(false);
        }
      });

    return () => {
      clearTimeout(timeout);
      if (!completed) {
        cancelQuickSchedulePhotoRecognition(requestId).catch(() => undefined);
      }
      if (photoRecognitionSequenceRef.current === sequence) {
        photoRecognitionSequenceRef.current += 1;
      }
    };
  }, [photoRecognitionAttempt, selectedPhoto?.uri]);

  /** 새 사진을 선택하거나 제거하고 OCR 재시도 번호를 올려 요청을 다시 시작한다. */
  const selectPhotoForRecognition = useCallback(
    (asset: ImagePickerAsset | null) => {
      setSelectedPhoto(asset);
      setPhotoRecognitionAttempt(current => current + 1);
    },
    [],
  );

  /** 현재 사진과 인식 결과를 즉시 비우고 진행 중 요청을 무효화한다. */
  const clearPhotoRecognition = useCallback(() => {
    photoRecognitionSequenceRef.current += 1;
    setSelectedPhoto(null);
    setPhotoTranscript("");
    setPhotoTranscriptTruncated(false);
    setPhotoRecognitionConfidence(undefined);
    setPhotoRecognitionError("");
    setIsPhotoRecognizing(false);
    setPhotoRecognitionAttempt(current => current + 1);
  }, []);

  /** 모달 종료 시 사진 인식 상태와 재시도 번호를 최초 상태로 되돌린다. */
  const resetPhotoRecognition = useCallback(() => {
    photoRecognitionSequenceRef.current += 1;
    setSelectedPhoto(null);
    setPhotoTranscript("");
    setPhotoTranscriptTruncated(false);
    setPhotoRecognitionConfidence(undefined);
    setPhotoRecognitionError("");
    setIsPhotoRecognizing(false);
    setPhotoRecognitionAttempt(0);
  }, []);

  return {
    isPhotoRecognizing,
    clearPhotoRecognition,
    photoRecognitionConfidence,
    photoRecognitionError,
    photoTranscript,
    photoTranscriptTruncated,
    resetPhotoRecognition,
    selectPhotoForRecognition,
    selectedPhoto,
    setPhotoRecognitionAttempt,
    setPhotoRecognitionConfidence,
    setPhotoRecognitionError,
    setPhotoTranscript,
    setPhotoTranscriptTruncated,
  };
}

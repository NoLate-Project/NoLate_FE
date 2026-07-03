#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <React/RCTBridgeModule.h>
#import <Speech/Speech.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>
#import <math.h>

@interface NoLateQuickInput : NSObject <RCTBridgeModule>
@end

@implementation NoLateQuickInput {
  dispatch_queue_t _visionQueue;
  SFSpeechRecognizer *_speechRecognizer;
  SFSpeechRecognitionTask *_speechTask;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    // Vision OCR은 이미지 디코딩과 문자 인식이 같이 일어나므로 메인 스레드에서 실행하지 않는다.
    // 직렬 큐로 처리해 여러 사진 요청이 동시에 들어와도 CPU 사용량과 Promise 완료 순서를 예측 가능하게 둔다.
    _visionQueue = dispatch_queue_create("com.nolate.quick-input.vision", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (NSURL *)fileURLFromURI:(NSString *)uri
{
  if (![uri isKindOfClass:[NSString class]] || uri.length == 0) {
    return nil;
  }

  NSURL *url = [NSURL URLWithString:uri];
  if (url.isFileURL) {
    return url;
  }

  NSString *decoded = [uri stringByRemovingPercentEncoding] ?: uri;
  if ([decoded hasPrefix:@"file://"]) {
    NSString *path = [decoded substringFromIndex:@"file://".length];
    return [NSURL fileURLWithPath:path];
  }

  if ([decoded hasPrefix:@"/"]) {
    return [NSURL fileURLWithPath:decoded];
  }

  return nil;
}

- (void)resolveOnMain:(RCTPromiseResolveBlock)resolve value:(id)value
{
  dispatch_async(dispatch_get_main_queue(), ^{
    resolve(value);
  });
}

- (void)rejectOnMain:(RCTPromiseRejectBlock)reject
                code:(NSString *)code
             message:(NSString *)message
               error:(NSError *)error
{
  dispatch_async(dispatch_get_main_queue(), ^{
    reject(code, message, error);
  });
}

- (CGImagePropertyOrientation)cgImagePropertyOrientationForUIImageOrientation:(UIImageOrientation)orientation
{
  switch (orientation) {
    case UIImageOrientationUp:
      return kCGImagePropertyOrientationUp;
    case UIImageOrientationDown:
      return kCGImagePropertyOrientationDown;
    case UIImageOrientationLeft:
      return kCGImagePropertyOrientationLeft;
    case UIImageOrientationRight:
      return kCGImagePropertyOrientationRight;
    case UIImageOrientationUpMirrored:
      return kCGImagePropertyOrientationUpMirrored;
    case UIImageOrientationDownMirrored:
      return kCGImagePropertyOrientationDownMirrored;
    case UIImageOrientationLeftMirrored:
      return kCGImagePropertyOrientationLeftMirrored;
    case UIImageOrientationRightMirrored:
      return kCGImagePropertyOrientationRightMirrored;
  }
}

- (NSArray<VNRecognizedTextObservation *> *)sortTextObservations:(NSArray<VNRecognizedTextObservation *> *)observations API_AVAILABLE(ios(13.0))
{
  // Vision의 boundingBox는 좌하단 기준 정규화 좌표다.
  // 사용자가 사진으로 찍은 일정표/메모는 대부분 위에서 아래로 읽히므로 y는 큰 값부터,
  // 같은 줄로 보이는 영역은 x가 작은 값부터 정렬해 원문 흐름을 최대한 보존한다.
  return [observations sortedArrayUsingComparator:^NSComparisonResult(VNRecognizedTextObservation *left,
                                                                      VNRecognizedTextObservation *right) {
    CGFloat leftTop = left.boundingBox.origin.y + left.boundingBox.size.height;
    CGFloat rightTop = right.boundingBox.origin.y + right.boundingBox.size.height;
    CGFloat yDistance = fabs(leftTop - rightTop);

    if (yDistance > 0.02) {
      return leftTop > rightTop ? NSOrderedAscending : NSOrderedDescending;
    }

    if (left.boundingBox.origin.x == right.boundingBox.origin.x) {
      return NSOrderedSame;
    }
    return left.boundingBox.origin.x < right.boundingBox.origin.x ? NSOrderedAscending : NSOrderedDescending;
  }];
}

RCT_REMAP_METHOD(recognizeTextFromImage,
                 recognizeTextFromImage:(NSString *)uri
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (@available(iOS 13.0, *)) {
    NSURL *fileURL = [self fileURLFromURI:uri];
    if (!fileURL) {
      reject(@"quick_input_invalid_image_uri", @"분석할 사진 파일 경로가 올바르지 않습니다.", nil);
      return;
    }

    dispatch_async(_visionQueue, ^{
      if (![[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
        [self rejectOnMain:reject
                      code:@"quick_input_image_not_found"
                   message:@"분석할 사진 파일을 찾을 수 없습니다."
                     error:nil];
        return;
      }

      UIImage *image = [UIImage imageWithContentsOfFile:fileURL.path];
      if (!image || !image.CGImage) {
        [self rejectOnMain:reject
                      code:@"quick_input_image_decode_failed"
                   message:@"사진 파일을 읽지 못했습니다."
                     error:nil];
        return;
      }

      VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
      request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
      request.usesLanguageCorrection = YES;
      request.recognitionLanguages = @[ @"ko-KR", @"en-US" ];

      VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image.CGImage
                                                                          orientation:[self cgImagePropertyOrientationForUIImageOrientation:image.imageOrientation]
                                                                              options:@{}];
      NSError *error = nil;
      [handler performRequests:@[ request ] error:&error];
      if (error) {
        [self rejectOnMain:reject
                      code:@"quick_input_ocr_failed"
                   message:@"사진에서 텍스트를 추출하지 못했습니다."
                     error:error];
        return;
      }

      NSArray<VNRecognizedTextObservation *> *sortedObservations = [self sortTextObservations:request.results ?: @[]];
      NSMutableArray<NSString *> *lines = [NSMutableArray arrayWithCapacity:sortedObservations.count];

      for (VNRecognizedTextObservation *observation in sortedObservations) {
        VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
        NSString *text = [candidate.string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (text.length > 0) {
          [lines addObject:text];
        }
      }

      // 줄 단위 개행은 유지한다. 백엔드 파서는 공백뿐 아니라 줄바꿈으로 분리된 OCR 메모도 처리할 수 있다.
      NSString *recognizedText = [lines componentsJoinedByString:@"\n"];
      [self resolveOnMain:resolve value:@{ @"text": recognizedText }];
    });
  } else {
    reject(@"quick_input_ocr_unavailable", @"이 iOS 버전에서는 사진 텍스트 추출을 사용할 수 없습니다.", nil);
  }
}

- (NSString *)speechAuthorizationMessageForStatus:(SFSpeechRecognizerAuthorizationStatus)status API_AVAILABLE(ios(10.0))
{
  switch (status) {
    case SFSpeechRecognizerAuthorizationStatusAuthorized:
      return @"";
    case SFSpeechRecognizerAuthorizationStatusDenied:
      return @"음성 인식 권한이 거부되어 있습니다.";
    case SFSpeechRecognizerAuthorizationStatusRestricted:
      return @"이 기기에서는 음성 인식을 사용할 수 없습니다.";
    case SFSpeechRecognizerAuthorizationStatusNotDetermined:
      return @"음성 인식 권한이 아직 결정되지 않았습니다.";
  }
  return @"음성 인식 권한 상태를 확인하지 못했습니다.";
}

RCT_REMAP_METHOD(transcribeAudioFile,
                 transcribeAudioFile:(NSString *)uri
                 localeIdentifier:(NSString *)localeIdentifier
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (@available(iOS 10.0, *)) {
    NSURL *fileURL = [self fileURLFromURI:uri];
    if (!fileURL) {
      reject(@"quick_input_invalid_audio_uri", @"분석할 음성 파일 경로가 올바르지 않습니다.", nil);
      return;
    }

    if (![[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
      reject(@"quick_input_audio_not_found", @"분석할 음성 파일을 찾을 수 없습니다.", nil);
      return;
    }

    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
      if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
        NSString *message = [self speechAuthorizationMessageForStatus:status];
        [self rejectOnMain:reject
                      code:@"quick_input_speech_permission_denied"
                   message:message.length > 0 ? message : @"음성 인식 권한이 필요합니다."
                     error:nil];
        return;
      }

      dispatch_async(dispatch_get_main_queue(), ^{
        // 한 번에 하나의 빠른일정 음성 분석만 유지한다. 사용자가 새 녹음을 바로 분석하면
        // 이전 작업을 취소해 늦게 도착한 결과가 새 입력을 덮어쓰지 않게 한다.
        [self->_speechTask cancel];
        self->_speechTask = nil;

        NSString *identifier = localeIdentifier.length > 0 ? localeIdentifier : @"ko-KR";
        NSLocale *locale = [NSLocale localeWithLocaleIdentifier:identifier];
        self->_speechRecognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];

        if (!self->_speechRecognizer || !self->_speechRecognizer.available) {
          reject(@"quick_input_speech_unavailable", @"현재 음성 인식 서비스를 사용할 수 없습니다.", nil);
          return;
        }

        SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:fileURL];
        request.shouldReportPartialResults = NO;
        request.taskHint = SFSpeechRecognitionTaskHintDictation;

        __block BOOL settled = NO;
        __weak typeof(self) weakSelf = self;
        self->_speechTask = [self->_speechRecognizer recognitionTaskWithRequest:request
                                                                  resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
          __strong typeof(weakSelf) strongSelf = weakSelf;
          if (!strongSelf || settled) {
            return;
          }

          if (error) {
            settled = YES;
            dispatch_async(dispatch_get_main_queue(), ^{
              strongSelf->_speechTask = nil;
              strongSelf->_speechRecognizer = nil;
              reject(@"quick_input_transcription_failed", @"음성을 텍스트로 변환하지 못했습니다.", error);
            });
            return;
          }

          if (result.isFinal) {
            settled = YES;
            NSString *transcript = result.bestTranscription.formattedString ?: @"";
            dispatch_async(dispatch_get_main_queue(), ^{
              strongSelf->_speechTask = nil;
              strongSelf->_speechRecognizer = nil;
              resolve(@{ @"text": transcript });
            });
          }
        }];
      });
    }];
  } else {
    reject(@"quick_input_speech_unavailable", @"이 iOS 버전에서는 음성 인식을 사용할 수 없습니다.", nil);
  }
}

@end

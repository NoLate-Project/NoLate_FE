#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <Speech/Speech.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>
#import <math.h>

@interface NoLateQuickInput : NSObject <RCTBridgeModule>
@end

static NSString *const NoLateQuickInputErrorDomain = @"com.nolate.quick-input";
static NSInteger const NoLateQuickInputImageDecodeError = 1001;
static NSInteger const NoLateQuickInputKoreanOcrUnsupportedError = 1002;

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

- (CGImageRef)newOCRImageFromURL:(NSURL *)fileURL
                      orientation:(CGImagePropertyOrientation *)orientation
                            error:(NSError **)error CF_RETURNS_RETAINED
{
  CGImageSourceRef imageSource = CGImageSourceCreateWithURL((__bridge CFURLRef)fileURL, NULL);
  if (!imageSource) {
    if (error) {
      *error = [NSError errorWithDomain:NoLateQuickInputErrorDomain
                                   code:NoLateQuickInputImageDecodeError
                               userInfo:@{ NSLocalizedDescriptionKey: @"이미지 소스를 열지 못했습니다." }];
    }
    return nil;
  }

  // CGImage에는 EXIF 방향이 포함되지 않는다. 썸네일 픽셀을 임의로 회전하지 않고 원본의
  // orientation 값을 별도로 꺼내 VNImageRequestHandler에 전달해야 좌표와 읽기 순서가 일치한다.
  NSDictionary *properties = CFBridgingRelease(
      CGImageSourceCopyPropertiesAtIndex(imageSource, 0, NULL));
  NSNumber *orientationValue = properties[(NSString *)kCGImagePropertyOrientation];
  NSUInteger rawOrientation = orientationValue.unsignedIntegerValue;
  if (rawOrientation < kCGImagePropertyOrientationUp ||
      rawOrientation > kCGImagePropertyOrientationLeftMirrored) {
    rawOrientation = kCGImagePropertyOrientationUp;
  }
  if (orientation) {
    *orientation = (CGImagePropertyOrientation)rawOrientation;
  }

  // 최근 iPhone의 48MP 사진을 네 방향 Accurate OCR로 그대로 처리하면 메모리와 지연이 크게
  // 늘어난다. 일정 메모의 획을 보존할 수 있는 3200px 상한으로 ImageIO에서 직접 다운샘플링해
  // 전체 원본을 먼저 디코딩하는 비용을 피한다. 작은 이미지는 확대하지 않는다.
  NSDictionary *thumbnailOptions = @{
    (NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
    (NSString *)kCGImageSourceCreateThumbnailWithTransform: @NO,
    (NSString *)kCGImageSourceThumbnailMaxPixelSize: @3200,
    (NSString *)kCGImageSourceShouldCacheImmediately: @YES,
  };
  CGImageRef image = CGImageSourceCreateThumbnailAtIndex(
      imageSource,
      0,
      (__bridge CFDictionaryRef)thumbnailOptions);
  CFRelease(imageSource);

  if (!image && error) {
    *error = [NSError errorWithDomain:NoLateQuickInputErrorDomain
                                 code:NoLateQuickInputImageDecodeError
                             userInfo:@{ NSLocalizedDescriptionKey: @"OCR용 이미지를 만들지 못했습니다." }];
  }
  return image;
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

- (NSUInteger)matchCountForPattern:(NSString *)pattern inText:(NSString *)text
{
  NSError *regexError = nil;
  NSRegularExpression *regex = [[NSRegularExpression alloc] initWithPattern:pattern
                                                                    options:NSRegularExpressionCaseInsensitive
                                                                      error:&regexError];
  if (!regex || regexError || text.length == 0) {
    return 0;
  }

  return [regex numberOfMatchesInString:text
                                options:0
                                  range:NSMakeRange(0, text.length)];
}

- (double)scoreRecognizedText:(NSString *)text
                 observations:(NSArray<VNRecognizedTextObservation *> *)observations API_AVAILABLE(ios(13.0))
{
  if (text.length == 0) {
    return 0;
  }

  // Vision confidence만으로 방향을 고를 수 없다. 손글씨 결과는 서로 다른 방향에서도 confidence가
  // 동일하게 0.5로 반환되는 경우가 있기 때문이다. 일정에 중요한 요일·시간·장소·이동 표기와
  // 가로로 놓인 문자 영역을 함께 점수화해, 글자 수만 많은 잘못된 방향이 선택되지 않게 한다.
  double score = MIN((double)text.length, 120.0) * 0.08;
  score += [self matchCountForPattern:@"(?:이번|다음)?\\s*[일월화수목금토]요일" inText:text] * 12.0;
  score += [self matchCountForPattern:@"(?:^|[^0-9])(?:오전|오후|저녁|밤|낮|새벽|아침)?\\s*(?:[01]?[0-9]|2[0-3])\\s*시" inText:text] * 14.0;
  score += [self matchCountForPattern:@"(?:20[0-9]{2}\\D*)?[0-9]{1,2}\\s*(?:월|[./-])\\s*[0-9]{1,2}\\s*일?" inText:text] * 12.0;
  score += [self matchCountForPattern:@"[가-힣A-Za-z0-9]+(?:역|터미널|공항|병원|학교|회사|카페|식당|센터|공원)" inText:text] * 4.0;
  score += [self matchCountForPattern:@"(?:에서|출발).+(?:까지|도착)" inText:text] * 20.0;

  // 실제 화살표가 OCR에서 `>>`로 단순화되는 경우에는 강한 이동 문맥으로 본다. 반면 숫자
  // `3`은 화살표가 그렇게 오인된 사례를 복구하되 오탐 가능성이 있어 더 낮은 보너스만 준다.
  score += [self matchCountForPattern:@"(?:->|=>|→|➜|➡|>+|≫|»|〉|》)" inText:text] * 24.0;
  score += [self matchCountForPattern:@"\\s+3\\s+" inText:text] * 7.0;

  for (VNRecognizedTextObservation *observation in observations) {
    VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
    score += candidate.confidence * 2.0;

    // 방향을 올바르게 적용하면 대부분의 문장 bounding box가 세로보다 넓어진다. 다만 세로로
    // 적은 메모도 허용해야 하므로 이 값은 일정 문맥 점수를 뒤집지 않는 작은 보조 점수로만 쓴다.
    CGFloat height = MAX(observation.boundingBox.size.height, 0.001);
    CGFloat horizontalRatio = observation.boundingBox.size.width / height;
    score += MIN(horizontalRatio, 6.0) * 0.5;
  }

  return score;
}

- (NSDictionary<NSString *, id> *)recognitionResultForCGImage:(CGImageRef)cgImage
                                                   orientation:(CGImagePropertyOrientation)orientation
                                                         error:(NSError **)error API_AVAILABLE(ios(13.0))
{
  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = YES;
  request.minimumTextHeight = 0.0f;
  request.preferBackgroundProcessing = YES;

  if (@available(iOS 16.0, *)) {
    // Revision 3부터 회전 및 손글씨 인식이 개선되고 한국어를 포함한 언어 범위가 확장된다.
    // 앱의 최소 iOS는 15.1이므로 런타임 분기를 유지하고, 아래 지원 언어 조회로 실제 가능
    // 여부를 다시 확인한다.
    request.revision = VNRecognizeTextRequestRevision3;
  }

  NSError *languageError = nil;
  NSArray<NSString *> *supportedLanguages =
      [request supportedRecognitionLanguagesAndReturnError:&languageError];
  if (!supportedLanguages || languageError) {
    if (error) {
      *error = languageError;
    }
    return nil;
  }

  NSString *koreanLanguage = [supportedLanguages filteredArrayUsingPredicate:
      [NSPredicate predicateWithBlock:^BOOL(NSString *language, NSDictionary *bindings) {
        return [language.lowercaseString hasPrefix:@"ko"];
      }]].firstObject;
  if (!koreanLanguage) {
    if (error) {
      *error = [NSError errorWithDomain:NoLateQuickInputErrorDomain
                                   code:NoLateQuickInputKoreanOcrUnsupportedError
                               userInfo:@{ NSLocalizedDescriptionKey: @"한국어 OCR을 지원하지 않는 iOS 버전입니다." }];
    }
    return nil;
  }

  NSString *englishLanguage = [supportedLanguages filteredArrayUsingPredicate:
      [NSPredicate predicateWithBlock:^BOOL(NSString *language, NSDictionary *bindings) {
        return [language.lowercaseString hasPrefix:@"en"];
      }]].firstObject;
  request.recognitionLanguages = englishLanguage
      ? @[ koreanLanguage, englishLanguage ]
      : @[ koreanLanguage ];

  // 손글씨에서 짧은 요일과 일정 라벨은 일반 단어보다 획 정보가 적어 다른 글자로 흔들리기 쉽다.
  // 특정 테스트 장소를 하드코딩하지 않고 입력 도메인에서 반복되는 공통 단어만 보정 사전에 둔다.
  request.customWords = @[
    @"월요일", @"화요일", @"수요일", @"목요일", @"금요일", @"토요일", @"일요일",
    @"오전", @"오후", @"출발지", @"도착지", @"출발", @"도착", @"일정"
  ];

  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage
                                                                      orientation:orientation
                                                                          options:@{}];
  if (![handler performRequests:@[ request ] error:error]) {
    return nil;
  }

  NSArray<VNRecognizedTextObservation *> *sortedObservations = [self sortTextObservations:request.results ?: @[]];
  NSMutableArray<NSString *> *lines = [NSMutableArray arrayWithCapacity:sortedObservations.count];
  for (VNRecognizedTextObservation *observation in sortedObservations) {
    VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
    NSString *line = [candidate.string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (line.length > 0) {
      [lines addObject:line];
    }
  }

  NSString *text = [lines componentsJoinedByString:@"\n"];
  double score = [self scoreRecognizedText:text observations:sortedObservations];
  return @{
    @"text": text,
    @"score": @(score),
    @"lineCount": @(lines.count),
    @"orientation": @(orientation),
  };
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

      NSError *imageError = nil;
      CGImagePropertyOrientation metadataOrientation = kCGImagePropertyOrientationUp;
      CGImageRef ocrImage = [self newOCRImageFromURL:fileURL
                                        orientation:&metadataOrientation
                                              error:&imageError];
      if (!ocrImage) {
        [self rejectOnMain:reject
                      code:@"quick_input_image_decode_failed"
                   message:@"사진 파일을 읽지 못했습니다."
                     error:imageError];
        return;
      }

      NSArray<NSNumber *> *orientationCandidates = @[
        @(metadataOrientation),
        @(kCGImagePropertyOrientationUp),
        @(kCGImagePropertyOrientationRight),
        @(kCGImagePropertyOrientationLeft),
        @(kCGImagePropertyOrientationDown),
      ];

      // PNG 공유, 스크린샷 변환, 일부 사진 선택기는 EXIF 방향을 제거한 채 픽셀만 전달한다.
      // 메타데이터 방향을 먼저 시도한 뒤 중복을 제외한 네 방향을 비교하면 사용자가 사진을
      // 회전해 다시 저장하지 않아도 된다. 실제 일정 텍스트는 개인정보 보호를 위해 로그에 남기지 않는다.
      NSMutableSet<NSNumber *> *attemptedOrientations = [NSMutableSet set];
      NSDictionary<NSString *, id> *bestResult = nil;
      NSError *lastError = nil;
      BOOL performedAnyRequest = NO;

      for (NSNumber *orientationValue in orientationCandidates) {
        if ([attemptedOrientations containsObject:orientationValue]) {
          continue;
        }
        [attemptedOrientations addObject:orientationValue];

        NSError *orientationError = nil;
        NSDictionary<NSString *, id> *result = nil;
        @autoreleasepool {
          result = [self recognitionResultForCGImage:ocrImage
                                         orientation:(CGImagePropertyOrientation)orientationValue.unsignedIntValue
                                               error:&orientationError];
        }
        if (!result) {
          lastError = orientationError;
          continue;
        }

        performedAnyRequest = YES;
        RCTLogInfo(@"[NoLateQuickInput] OCR orientation=%@ score=%.2f lines=%@",
                   orientationValue,
                   [result[@"score"] doubleValue],
                   result[@"lineCount"]);

        if (!bestResult || [result[@"score"] doubleValue] > [bestResult[@"score"] doubleValue]) {
          bestResult = result;
        }
      }

      if (!performedAnyRequest && lastError) {
        CGImageRelease(ocrImage);
        NSString *message = lastError.code == NoLateQuickInputKoreanOcrUnsupportedError
            ? @"이 iOS 버전에서는 한국어 사진 인식을 지원하지 않습니다. iOS 16 이상에서 다시 시도해주세요."
            : @"사진에서 텍스트를 추출하지 못했습니다.";
        [self rejectOnMain:reject
                      code:@"quick_input_ocr_failed"
                   message:message
                     error:lastError];
        return;
      }

      // 줄 단위 개행은 유지한다. 백엔드 파서는 공백뿐 아니라 줄바꿈으로 분리된 OCR 메모도 처리할 수 있다.
      NSString *recognizedText = bestResult[@"text"] ?: @"";
      CGImageRelease(ocrImage);
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

- (BOOL)audioFileContainsAudibleSignal:(NSURL *)fileURL
                                 error:(NSError **)error
{
  AVAudioFile *audioFile = [[AVAudioFile alloc] initForReading:fileURL error:error];
  if (!audioFile) {
    return NO;
  }

  AVAudioFormat *format = audioFile.processingFormat;
  AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:4096];
  if (!buffer) {
    return NO;
  }

  // 시뮬레이터에서 녹음 권한과 타이머는 정상이어도 Mac 시스템 출력이 마이크 입력으로
  // 연결되지 않으면 AAC 컨테이너 안에 디지털 무음만 저장된다. 이런 파일을 Speech에 넘기면
  // final result가 오지 않고 오래 대기하는 경우가 있으므로 PCM peak를 먼저 확인한다.
  // -54 dBFS 정도의 매우 낮은 문턱만 사용해 조용한 실제 발화는 통과시키고 완전한 무음만 거른다.
  const float audiblePeakThreshold = 0.002f;
  while (YES) {
    NSError *readError = nil;
    BOOL readSucceeded = [audioFile readIntoBuffer:buffer error:&readError];
    if (!readSucceeded) {
      if (error) {
        *error = readError;
      }
      return NO;
    }

    AVAudioFrameCount frameLength = buffer.frameLength;
    if (frameLength == 0) {
      break;
    }

    float *const *channelData = buffer.floatChannelData;
    if (!channelData) {
      break;
    }

    for (AVAudioChannelCount channel = 0; channel < format.channelCount; channel += 1) {
      float *samples = channelData[channel];
      for (AVAudioFrameCount frame = 0; frame < frameLength; frame += 1) {
        if (fabsf(samples[frame]) >= audiblePeakThreshold) {
          return YES;
        }
      }
    }
  }

  return NO;
}

- (NSString *)speechRecognitionMessageForError:(NSError *)error
{
  // Speech 프레임워크의 세부 domain/code는 iOS 버전에 따라 달라질 수 있어 사용자에게 그대로
  // 노출하지 않는다. 진단 정보는 RCTLog에 남기고 화면에는 다음 행동이 분명한 문장을 반환한다.
  if ([error.domain isEqualToString:@"kLSRErrorDomain"]) {
    switch (error.code) {
      case 102:
        return @"한국어 음성 인식 모델이 준비되지 않았습니다. 받아쓰기 언어 설정을 확인해주세요.";
      case 201:
        return @"Siri 또는 받아쓰기가 꺼져 있습니다. 기기 설정에서 받아쓰기를 켜주세요.";
      case 300:
        return @"음성 인식 엔진을 시작하지 못했습니다. 시뮬레이터를 재시작하거나 실제 기기에서 다시 시도해주세요.";
      default:
        return @"기기의 음성 인식 엔진을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.";
    }
  }

  if ([error.domain isEqualToString:@"kAFAssistantErrorDomain"] ||
      [error.domain isEqualToString:@"SFSpeechErrorDomain"]) {
    return @"음성을 인식하지 못했습니다. 주변 소음을 줄이고 다시 녹음해주세요.";
  }
  return @"음성을 텍스트로 변환하지 못했습니다. 잠시 후 다시 시도해주세요.";
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

    NSError *audioReadError = nil;
    if (![self audioFileContainsAudibleSignal:fileURL error:&audioReadError]) {
      if (audioReadError) {
        RCTLogWarn(@"[NoLateQuickInput] Audio validation failed. domain=%@ code=%ld",
                   audioReadError.domain,
                   (long)audioReadError.code);
        reject(@"quick_input_audio_decode_failed", @"녹음 파일을 읽지 못했습니다. 다시 녹음해주세요.", audioReadError);
      } else {
        RCTLogWarn(@"[NoLateQuickInput] Recorded audio contains no audible signal.");
        reject(@"quick_input_no_speech", @"녹음에서 음성을 감지하지 못했습니다. 마이크 입력을 확인하고 다시 녹음해주세요.", nil);
      }
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
        if (@available(iOS 13.0, *)) {
          // supportsOnDeviceRecognition이 YES여도 해당 언어 모델이 아직 내려받아지지 않은
          // 시뮬레이터/기기에서는 강제 온디바이스 요청이 kLSRErrorDomain 102로 실패할 수 있다.
          // 강제 플래그를 끄면 Speech가 설치 상태와 네트워크를 고려해 사용 가능한 경로를 고른다.
          request.requiresOnDeviceRecognition = NO;
          RCTLogInfo(@"[NoLateQuickInput] Speech recognizer ready. onDeviceSupported=%@ locale=%@",
                     self->_speechRecognizer.supportsOnDeviceRecognition ? @"YES" : @"NO",
                     identifier);
        }

        __block BOOL settled = NO;
        __weak typeof(self) weakSelf = self;
        __block SFSpeechRecognitionTask *activeTask = nil;
        activeTask = [self->_speechRecognizer recognitionTaskWithRequest:request
                                                            resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
          __strong typeof(weakSelf) strongSelf = weakSelf;
          if (!strongSelf) {
            return;
          }

          // Speech 콜백 큐와 timeout 큐가 동시에 Promise를 끝내지 않도록 모든 완료 판단을
          // 메인 큐에서 직렬화한다. 일부 iOS 버전은 사용할 수 있는 마지막 전사와 종료 오류를
          // 같은 콜백에 전달하므로, 오류보다 비어 있지 않은 transcript를 먼저 채택한다.
          dispatch_async(dispatch_get_main_queue(), ^{
            if (settled || strongSelf->_speechTask != activeTask) {
              return;
            }

            NSString *transcript = [result.bestTranscription.formattedString
                stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] ?: @"";
            if (transcript.length > 0 && (result.isFinal || error)) {
              settled = YES;
              strongSelf->_speechTask = nil;
              strongSelf->_speechRecognizer = nil;
              resolve(@{ @"text": transcript });
              return;
            }

            if (error) {
              settled = YES;
              RCTLogWarn(@"[NoLateQuickInput] Speech recognition failed. domain=%@ code=%ld",
                         error.domain,
                         (long)error.code);
              strongSelf->_speechTask = nil;
              strongSelf->_speechRecognizer = nil;
              reject(@"quick_input_transcription_failed",
                     [strongSelf speechRecognitionMessageForError:error],
                     error);
            }
          });
        }];
        self->_speechTask = activeTask;

        // 네트워크 기반 Speech 서비스가 응답하지 않거나 final result를 보내지 않는 경우에도
        // 빠른 일정 화면이 분석 중 상태에 계속 머물지 않도록 명시적인 상한을 둔다.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
          __strong typeof(weakSelf) strongSelf = weakSelf;
          if (!strongSelf || settled || strongSelf->_speechTask != activeTask) {
            return;
          }

          settled = YES;
          [activeTask cancel];
          strongSelf->_speechTask = nil;
          strongSelf->_speechRecognizer = nil;
          reject(@"quick_input_transcription_timeout",
                 @"음성 인식 시간이 초과됐습니다. 네트워크와 마이크 입력을 확인해주세요.",
                 nil);
        });
      });
    }];
  } else {
    reject(@"quick_input_speech_unavailable", @"이 iOS 버전에서는 음성 인식을 사용할 수 없습니다.", nil);
  }
}

@end

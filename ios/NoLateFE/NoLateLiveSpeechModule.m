#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>
#import <Speech/Speech.h>
#import <TargetConditionals.h>
#import <stdatomic.h>

static NSString *const NoLateLiveSpeechTranscriptEvent = @"NoLateLiveSpeechTranscript";
static NSString *const NoLateLiveSpeechLevelEvent = @"NoLateLiveSpeechLevel";
static NSString *const NoLateLiveSpeechStateEvent = @"NoLateLiveSpeechState";

@interface NoLateLiveSpeech : RCTEventEmitter <RCTBridgeModule>
@end

@implementation NoLateLiveSpeech {
  dispatch_queue_t _sessionQueue;
  AVAudioEngine *_audioEngine;
  SFSpeechRecognizer *_speechRecognizer;
  SFSpeechAudioBufferRecognitionRequest *_recognitionRequest;
  SFSpeechRecognitionTask *_recognitionTask;
  dispatch_source_t _durationTimer;
  dispatch_source_t _levelTimer;
  NSString *_sessionId;
  NSUInteger _sessionGeneration;
  NSString *_latestText;
  double _latestConfidence;
  BOOL _hasConfidence;
  BOOL _stopRequested;
  BOOL _hasListeners;
  CFTimeInterval _startedAt;
  atomic_uint_fast32_t _pendingRmsLevel;
  atomic_uint_fast32_t _pendingPeakLevel;
  atomic_bool _hasPendingLevel;
  RCTPromiseResolveBlock _pendingStopResolve;
  RCTPromiseRejectBlock _pendingStopReject;
  NSString *_previousAudioCategory;
  NSString *_previousAudioMode;
  AVAudioSessionCategoryOptions _previousAudioOptions;
  BOOL _hasPreviousAudioSessionConfiguration;
  NSString *_pendingStartSessionId;
  NSUInteger _startGeneration;
  RCTPromiseRejectBlock _pendingStartReject;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _sessionQueue = dispatch_queue_create("com.nolate.live-speech.session", DISPATCH_QUEUE_SERIAL);
    atomic_init(&_pendingRmsLevel, 0);
    atomic_init(&_pendingPeakLevel, 0);
    atomic_init(&_hasPendingLevel, false);
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[
    NoLateLiveSpeechTranscriptEvent,
    NoLateLiveSpeechLevelEvent,
    NoLateLiveSpeechStateEvent,
  ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

- (void)emitEvent:(NSString *)name body:(NSDictionary *)body
{
  if (!_hasListeners) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_hasListeners) return;
    [self sendEventWithName:name body:body];
  });
}

- (double)elapsedMillis
{
  if (_startedAt <= 0) return 0;
  return MAX(0, (CACurrentMediaTime() - _startedAt) * 1000.0);
}

- (void)emitState:(NSString *)state sessionId:(NSString *)sessionId message:(NSString *)message
{
  if (sessionId.length == 0) return;
  NSMutableDictionary *body = [@{
    @"sessionId": sessionId,
    @"state": state,
  } mutableCopy];
  if (message.length > 0) body[@"message"] = message;
  [self emitEvent:NoLateLiveSpeechStateEvent body:body];
}

- (NSDictionary *)resultBodyForSessionId:(NSString *)sessionId isFinal:(BOOL)isFinal
{
  NSMutableDictionary *body = [@{
    @"sessionId": sessionId ?: @"",
    @"text": _latestText ?: @"",
    @"isFinal": @(isFinal),
    @"elapsedMillis": @([self elapsedMillis]),
  } mutableCopy];
  if (_hasConfidence) body[@"confidence"] = @(MIN(1.0, MAX(0.0, _latestConfidence)));
  return body;
}

- (void)emitTranscriptForSessionId:(NSString *)sessionId isFinal:(BOOL)isFinal
{
  if (sessionId.length == 0) return;
  [self emitEvent:NoLateLiveSpeechTranscriptEvent
             body:[self resultBodyForSessionId:sessionId isFinal:isFinal]];
}

- (double)averageConfidenceForTranscription:(SFTranscription *)transcription
{
  if (transcription.segments.count == 0) return -1;
  double total = 0;
  for (SFTranscriptionSegment *segment in transcription.segments) {
    total += segment.confidence;
  }
  return total / transcription.segments.count;
}

- (void)captureLevelForBuffer:(AVAudioPCMBuffer *)buffer
{
  if (buffer.frameLength == 0) return;
  float *const *channels = buffer.floatChannelData;
  if (channels == NULL) return;
  float rms = 0;
  float peak = 0;
  vDSP_rmsqv(channels[0], 1, &rms, buffer.frameLength);
  vDSP_maxmgv(channels[0], 1, &peak, buffer.frameLength);
  uint_fast32_t normalizedRms = (uint_fast32_t)llround(MIN(1.0, MAX(0.0, rms * 9.0)) * 10000.0);
  uint_fast32_t normalizedPeak = (uint_fast32_t)llround(MIN(1.0, MAX(0.0, peak * 5.0)) * 10000.0);
  atomic_store_explicit(&_pendingRmsLevel, normalizedRms, memory_order_relaxed);
  atomic_store_explicit(&_pendingPeakLevel, normalizedPeak, memory_order_relaxed);
  atomic_store_explicit(&_hasPendingLevel, true, memory_order_release);
}

- (NSString *)speechAuthorizationMessage:(SFSpeechRecognizerAuthorizationStatus)status
{
  switch (status) {
    case SFSpeechRecognizerAuthorizationStatusDenied:
      return @"음성 인식 권한이 꺼져 있습니다. 설정에서 음성 인식 권한을 허용해 주세요.";
    case SFSpeechRecognizerAuthorizationStatusRestricted:
      return @"이 기기에서는 음성 인식 사용이 제한되어 있습니다.";
    case SFSpeechRecognizerAuthorizationStatusNotDetermined:
      return @"음성 인식 권한을 확인하지 못했습니다.";
    case SFSpeechRecognizerAuthorizationStatusAuthorized:
      return nil;
  }
}

- (void)requestPermissions:(void (^)(NSString *message))completion
{
  void (^requestMicrophone)(void) = ^{
    AVAudioSession *session = AVAudioSession.sharedInstance;
    AVAudioSessionRecordPermission permission = session.recordPermission;
    if (permission == AVAudioSessionRecordPermissionGranted) {
      completion(nil);
      return;
    }
    if (permission == AVAudioSessionRecordPermissionDenied) {
      completion(@"마이크 권한이 꺼져 있습니다. 설정에서 마이크 권한을 허용해 주세요.");
      return;
    }
    [session requestRecordPermission:^(BOOL granted) {
      completion(granted
        ? nil
        : @"마이크 권한이 필요합니다. 설정에서 마이크 권한을 허용해 주세요.");
    }];
  };

  SFSpeechRecognizerAuthorizationStatus speechStatus = SFSpeechRecognizer.authorizationStatus;
  if (speechStatus == SFSpeechRecognizerAuthorizationStatusAuthorized) {
    requestMicrophone();
    return;
  }
  if (speechStatus != SFSpeechRecognizerAuthorizationStatusNotDetermined) {
    completion([self speechAuthorizationMessage:speechStatus]);
    return;
  }

  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    NSString *message = [self speechAuthorizationMessage:status];
    if (message) {
      completion(message);
      return;
    }
    requestMicrophone();
  }];
}

- (NSArray<NSString *> *)normalizedContextFromOptions:(NSDictionary *)options
{
  NSArray *values = [options[@"contextualStrings"] isKindOfClass:NSArray.class]
    ? options[@"contextualStrings"]
    : @[];
  NSMutableOrderedSet<NSString *> *phrases = [NSMutableOrderedSet orderedSet];
  for (id value in values) {
    if (![value isKindOfClass:NSString.class]) continue;
    NSString *phrase = [(NSString *)value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (phrase.length >= 2 && phrase.length <= 20) [phrases addObject:phrase];
    if (phrases.count >= 100) break;
  }
  return phrases.array;
}

- (NSString *)normalizedLocaleIdentifierFromValue:(id)value
{
  NSString *localeIdentifier = [value isKindOfClass:NSString.class]
    ? [(NSString *)value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]
    : @"";
  return localeIdentifier.length > 0 ? localeIdentifier : @"ko-KR";
}

- (BOOL)isPendingStartForSessionId:(NSString *)sessionId generation:(NSUInteger)generation
{
  return generation == _startGeneration
    && [_pendingStartSessionId isEqualToString:sessionId];
}

- (void)clearPendingStartForSessionId:(NSString *)sessionId generation:(NSUInteger)generation
{
  if (![self isPendingStartForSessionId:sessionId generation:generation]) return;
  _pendingStartSessionId = nil;
  _pendingStartReject = nil;
}

- (BOOL)cancelPendingStartForSessionId:(NSString *)sessionId message:(NSString *)message
{
  if (![_pendingStartSessionId isEqualToString:sessionId]) return NO;

  RCTPromiseRejectBlock reject = _pendingStartReject;
  _pendingStartSessionId = nil;
  _pendingStartReject = nil;
  _startGeneration += 1;
  [self emitState:@"cancelled" sessionId:sessionId message:nil];

  if (reject) {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"live_speech_cancelled",
             message.length > 0 ? message : @"음성 인식 시작을 취소했습니다.",
             nil);
    });
  }
  return YES;
}

- (void)cancelDurationTimer
{
  if (_durationTimer) {
    dispatch_source_cancel(_durationTimer);
    _durationTimer = nil;
  }
}

- (void)cancelLevelTimer
{
  if (_levelTimer) {
    dispatch_source_cancel(_levelTimer);
    _levelTimer = nil;
  }
  atomic_store_explicit(&_hasPendingLevel, false, memory_order_release);
}

- (BOOL)isActiveSessionId:(NSString *)sessionId generation:(NSUInteger)generation
{
  return _sessionGeneration == generation && [_sessionId isEqualToString:sessionId];
}

- (void)scheduleLevelEventsForSessionId:(NSString *)sessionId
                             generation:(NSUInteger)generation
{
  [self cancelLevelTimer];
  _levelTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _sessionQueue);
  dispatch_source_set_timer(
    _levelTimer,
    dispatch_time(DISPATCH_TIME_NOW, 0),
    (uint64_t)(NSEC_PER_SEC / 24),
    (uint64_t)(NSEC_PER_SEC / 120)
  );
  dispatch_source_set_event_handler(_levelTimer, ^{
    if (![self isActiveSessionId:sessionId generation:generation]) return;
    if (!atomic_exchange_explicit(&self->_hasPendingLevel, false, memory_order_acq_rel)) return;

    double rms = atomic_load_explicit(&self->_pendingRmsLevel, memory_order_relaxed) / 10000.0;
    double peak = atomic_load_explicit(&self->_pendingPeakLevel, memory_order_relaxed) / 10000.0;
    [self emitEvent:NoLateLiveSpeechLevelEvent
               body:@{
                 @"sessionId": sessionId,
                 @"rms": @(rms),
                 @"peak": @(peak),
                 @"elapsedMillis": @([self elapsedMillis]),
               }];
  });
  dispatch_resume(_levelTimer);
}

- (void)stopAudioCapture
{
  [self cancelDurationTimer];
  [self cancelLevelTimer];
  if (_audioEngine.isRunning) [_audioEngine stop];
  @try {
    [_audioEngine.inputNode removeTapOnBus:0];
  } @catch (__unused NSException *exception) {
  }
  [_recognitionRequest endAudio];
}

- (void)captureAudioSessionConfiguration:(AVAudioSession *)audioSession
{
  if (_hasPreviousAudioSessionConfiguration) return;
  _previousAudioCategory = [audioSession.category copy];
  _previousAudioMode = [audioSession.mode copy];
  _previousAudioOptions = audioSession.categoryOptions;
  _hasPreviousAudioSessionConfiguration = YES;
}

- (void)restoreAudioSessionConfiguration
{
  AVAudioSession *audioSession = AVAudioSession.sharedInstance;
  NSError *deactivationError = nil;
  [audioSession setActive:NO
              withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                    error:&deactivationError];
  if (deactivationError) {
    RCTLogWarn(@"[NoLateLiveSpeech] Audio session deactivation failed. domain=%@ code=%ld",
               deactivationError.domain,
               (long)deactivationError.code);
  }

  if (_hasPreviousAudioSessionConfiguration && _previousAudioCategory.length > 0) {
    NSError *restoreError = nil;
    [audioSession setCategory:_previousAudioCategory
                         mode:_previousAudioMode ?: AVAudioSessionModeDefault
                      options:_previousAudioOptions
                        error:&restoreError];
    if (restoreError) {
      RCTLogWarn(@"[NoLateLiveSpeech] Audio session restore failed. domain=%@ code=%ld",
                 restoreError.domain,
                 (long)restoreError.code);
      NSError *fallbackError = nil;
      [audioSession setCategory:AVAudioSessionCategorySoloAmbient
                           mode:AVAudioSessionModeDefault
                        options:0
                          error:&fallbackError];
      if (fallbackError) {
        RCTLogWarn(@"[NoLateLiveSpeech] Audio session fallback failed. domain=%@ code=%ld",
                   fallbackError.domain,
                   (long)fallbackError.code);
      }
    }
  }

  _previousAudioCategory = nil;
  _previousAudioMode = nil;
  _previousAudioOptions = 0;
  _hasPreviousAudioSessionConfiguration = NO;
}

- (void)clearSessionState
{
  [self cancelDurationTimer];
  [self cancelLevelTimer];
  _audioEngine = nil;
  _speechRecognizer = nil;
  _recognitionRequest = nil;
  _recognitionTask = nil;
  _sessionId = nil;
  _sessionGeneration += 1;
  _latestText = nil;
  _latestConfidence = 0;
  _hasConfidence = NO;
  _stopRequested = NO;
  _startedAt = 0;
  _pendingStopResolve = nil;
  _pendingStopReject = nil;
}

- (void)finishSession:(NSString *)sessionId state:(NSString *)state errorMessage:(NSString *)errorMessage
{
  if (![_sessionId isEqualToString:sessionId]) return;
  [self stopAudioCapture];

  BOOL cancelled = [state isEqualToString:@"cancelled"];
  BOOL failed = [state isEqualToString:@"failed"];
  BOOL hasText = _latestText.length > 0;
  NSDictionary *result = [self resultBodyForSessionId:sessionId isFinal:YES];
  RCTPromiseResolveBlock stopResolve = _pendingStopResolve;
  RCTPromiseRejectBlock stopReject = _pendingStopReject;

  if (!cancelled && hasText) [self emitTranscriptForSessionId:sessionId isFinal:YES];
  [self emitState:state sessionId:sessionId message:errorMessage];

  [_recognitionTask cancel];
  [self restoreAudioSessionConfiguration];
  [self clearSessionState];

  if (stopResolve || stopReject) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!failed && !cancelled && hasText) {
        stopResolve(result);
      } else {
        NSString *message = errorMessage.length > 0
          ? errorMessage
          : @"음성에서 일정 텍스트를 찾지 못했습니다. 다시 말해 주세요.";
        NSString *code = cancelled
          ? @"live_speech_cancelled"
          : failed ? @"live_speech_failed" : @"live_speech_empty";
        stopReject(code, message, nil);
      }
    });
  }
}

- (void)beginStoppingSession:(NSString *)sessionId generation:(NSUInteger)generation
{
  if (![self isActiveSessionId:sessionId generation:generation] || _stopRequested) return;
  _stopRequested = YES;
  [self emitState:@"stopping" sessionId:sessionId message:nil];
  [self stopAudioCapture];

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.6 * NSEC_PER_SEC)), _sessionQueue, ^{
    if (![self isActiveSessionId:sessionId generation:generation]) return;
    [self finishSession:sessionId
                  state:self->_latestText.length > 0 ? @"finished" : @"failed"
           errorMessage:self->_latestText.length > 0
             ? nil
             : @"음성에서 일정 텍스트를 찾지 못했습니다. 다시 말해 주세요."];
  });
}

- (void)scheduleDurationLimit:(double)durationMillis
                    sessionId:(NSString *)sessionId
                   generation:(NSUInteger)generation
{
  [self cancelDurationTimer];
  _durationTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _sessionQueue);
  dispatch_source_set_timer(
    _durationTimer,
    dispatch_time(DISPATCH_TIME_NOW, (int64_t)(durationMillis * NSEC_PER_MSEC)),
    DISPATCH_TIME_FOREVER,
    (uint64_t)(0.1 * NSEC_PER_SEC)
  );
  dispatch_source_set_event_handler(_durationTimer, ^{
    [self beginStoppingSession:sessionId generation:generation];
  });
  dispatch_resume(_durationTimer);
}

RCT_REMAP_METHOD(getAvailability,
                 getAvailabilityForLocaleIdentifier:(NSString *)localeIdentifier
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
#if TARGET_OS_SIMULATOR
  resolve(@{
    @"serviceAvailable": @NO,
    @"supportsOnDevice": @NO,
    @"reason": @"iOS 시뮬레이터에서는 실시간 음성 인식을 사용할 수 없습니다. 실기기에서 확인해 주세요.",
  });
#else
  dispatch_async(_sessionQueue, ^{
    NSString *normalizedLocale = [self normalizedLocaleIdentifierFromValue:localeIdentifier];
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc]
      initWithLocale:[[NSLocale alloc] initWithLocaleIdentifier:normalizedLocale]];
    BOOL serviceAvailable = recognizer != nil && recognizer.available;
    BOOL supportsOnDevice = NO;
    if (@available(iOS 13.0, *)) {
      supportsOnDevice = recognizer != nil && recognizer.supportsOnDeviceRecognition;
    }

    NSString *reason = nil;
    if (!recognizer) {
      reason = @"선택한 언어의 음성 인식기를 만들 수 없습니다.";
    } else if (!serviceAvailable) {
      reason = @"현재 선택한 언어의 음성 인식 서비스를 사용할 수 없습니다.";
    } else if (!supportsOnDevice) {
      reason = @"이 기기에는 선택한 언어의 온디바이스 음성 인식 모델이 없습니다.";
    }

    NSMutableDictionary *result = [@{
      @"serviceAvailable": @(serviceAvailable),
      @"supportsOnDevice": @(supportsOnDevice),
    } mutableCopy];
    if (reason.length > 0) result[@"reason"] = reason;
    resolve(result);
  });
#endif
}

RCT_REMAP_METHOD(start,
                 startWithOptions:(NSDictionary *)options
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *requestedSessionId = [options[@"sessionId"] isKindOfClass:NSString.class]
    ? [options[@"sessionId"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]
    : @"";
  NSString *sessionId = requestedSessionId.length > 0 && requestedSessionId.length <= 128
    ? requestedSessionId
    : NSUUID.UUID.UUIDString.lowercaseString;
#if TARGET_OS_SIMULATOR
  NSString *simulatorMessage = @"iOS 시뮬레이터에서는 실시간 음성 인식을 사용할 수 없습니다. 실기기에서 확인해 주세요.";
  [self emitState:@"failed" sessionId:sessionId message:simulatorMessage];
  reject(@"live_speech_unavailable", simulatorMessage, nil);
#else
  NSDictionary *startOptions = [options copy] ?: @{};
  dispatch_async(_sessionQueue, ^{
    if (self->_pendingStartSessionId.length > 0) {
      [self cancelPendingStartForSessionId:self->_pendingStartSessionId
                                   message:@"새 음성 인식 요청으로 이전 시작을 취소했습니다."];
    }
    NSUInteger generation = ++self->_startGeneration;
    self->_pendingStartSessionId = sessionId;
    self->_pendingStartReject = [reject copy];
    [self emitState:@"starting" sessionId:sessionId message:nil];

    [self requestPermissions:^(NSString *message) {
      dispatch_async(self->_sessionQueue, ^{
        if (![self isPendingStartForSessionId:sessionId generation:generation]) return;

        void (^rejectPendingStart)(NSString *, NSString *, NSError *) = ^(
          NSString *code,
          NSString *errorMessage,
          NSError *error
        ) {
          if (![self isPendingStartForSessionId:sessionId generation:generation]) return;
          [self clearPendingStartForSessionId:sessionId generation:generation];
          reject(code, errorMessage, error);
        };

        if (message.length > 0) {
          [self emitState:@"failed" sessionId:sessionId message:message];
          rejectPendingStart(@"live_speech_permission", message, nil);
          return;
        }

      if (self->_sessionId.length > 0) {
        [self finishSession:self->_sessionId state:@"cancelled" errorMessage:nil];
      }

      NSString *localeIdentifier = [self normalizedLocaleIdentifierFromValue:startOptions[@"localeIdentifier"]];
      double durationMillis = [startOptions[@"maxDurationMillis"] respondsToSelector:@selector(doubleValue)]
        ? [startOptions[@"maxDurationMillis"] doubleValue]
        : 60000;
      durationMillis = MIN(120000, MAX(5000, durationMillis));
      BOOL requiresOnDeviceRecognition = ![startOptions[@"requiresOnDeviceRecognition"] isKindOfClass:NSNumber.class]
        || [startOptions[@"requiresOnDeviceRecognition"] boolValue];

      NSLocale *locale = [[NSLocale alloc] initWithLocaleIdentifier:localeIdentifier];
      SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
      if (!recognizer || !recognizer.available) {
        NSString *errorMessage = @"현재 선택한 언어의 음성 인식 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
        [self emitState:@"failed" sessionId:sessionId message:errorMessage];
        rejectPendingStart(@"live_speech_unavailable", errorMessage, nil);
        return;
      }

      if (requiresOnDeviceRecognition) {
        if (@available(iOS 13.0, *)) {
          if (!recognizer.supportsOnDeviceRecognition) {
            NSString *errorMessage = @"이 기기에는 선택한 언어의 온디바이스 음성 인식이 준비되지 않았습니다. iOS 설정과 언어 다운로드 상태를 확인해 주세요.";
            [self emitState:@"failed" sessionId:sessionId message:errorMessage];
            rejectPendingStart(@"live_speech_on_device_unavailable", errorMessage, nil);
            return;
          }
        } else {
          NSString *errorMessage = @"이 iOS 버전에서는 온디바이스 음성 인식을 사용할 수 없습니다.";
          [self emitState:@"failed" sessionId:sessionId message:errorMessage];
          rejectPendingStart(@"live_speech_on_device_unavailable", errorMessage, nil);
          return;
        }
      }

      NSError *audioError = nil;
      AVAudioSession *audioSession = AVAudioSession.sharedInstance;
      [self captureAudioSessionConfiguration:audioSession];
      [audioSession setCategory:AVAudioSessionCategoryRecord
                           mode:AVAudioSessionModeMeasurement
                        options:AVAudioSessionCategoryOptionAllowBluetoothHFP
                          error:&audioError];
      if (!audioError) [audioSession setActive:YES error:&audioError];
      if (audioError) {
        [self restoreAudioSessionConfiguration];
        NSString *errorMessage = @"마이크 세션을 시작하지 못했습니다. 다른 녹음 앱을 종료하고 다시 시도해 주세요.";
        [self emitState:@"failed" sessionId:sessionId message:errorMessage];
        rejectPendingStart(@"live_speech_audio_session", errorMessage, audioError);
        return;
      }

      NSUInteger sessionGeneration = ++self->_sessionGeneration;
      self->_sessionId = sessionId;
      self->_latestText = @"";
      self->_latestConfidence = 0;
      self->_hasConfidence = NO;
      self->_stopRequested = NO;
      self->_startedAt = CACurrentMediaTime();
      self->_speechRecognizer = recognizer;
      self->_recognitionRequest = [SFSpeechAudioBufferRecognitionRequest new];
      self->_recognitionRequest.shouldReportPartialResults = YES;
      self->_recognitionRequest.taskHint = SFSpeechRecognitionTaskHintDictation;
      self->_recognitionRequest.contextualStrings = [self normalizedContextFromOptions:startOptions];
      if (@available(iOS 16.0, *)) self->_recognitionRequest.addsPunctuation = YES;
      if (@available(iOS 13.0, *)) {
        self->_recognitionRequest.requiresOnDeviceRecognition = requiresOnDeviceRecognition;
      }

      self->_audioEngine = [AVAudioEngine new];
      AVAudioInputNode *inputNode = self->_audioEngine.inputNode;
      AVAudioFormat *inputFormat = [inputNode outputFormatForBus:0];
      if (inputFormat.sampleRate <= 0 || inputFormat.channelCount == 0) {
        NSString *errorMessage = @"마이크 입력 형식을 확인하지 못했습니다.";
        [self finishSession:sessionId state:@"failed" errorMessage:errorMessage];
        rejectPendingStart(@"live_speech_input_format", errorMessage, nil);
        return;
      }

      SFSpeechAudioBufferRecognitionRequest *activeRequest = self->_recognitionRequest;
      __weak typeof(self) weakSelf = self;
      [inputNode installTapOnBus:0
                      bufferSize:1024
                          format:inputFormat
                           block:^(AVAudioPCMBuffer *buffer, __unused AVAudioTime *when) {
        [activeRequest appendAudioPCMBuffer:buffer];
        [weakSelf captureLevelForBuffer:buffer];
      }];

      __block __weak SFSpeechRecognitionTask *activeTask = nil;
      activeTask = [recognizer recognitionTaskWithRequest:activeRequest
                                             resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
        typeof(self) queuedSelf = weakSelf;
        if (!queuedSelf) return;
        dispatch_async(queuedSelf->_sessionQueue, ^{
          typeof(self) strongSelf = queuedSelf;
          if (!strongSelf
              || strongSelf->_sessionGeneration != sessionGeneration
              || strongSelf->_recognitionTask != activeTask
              || ![strongSelf->_sessionId isEqualToString:sessionId]) return;

          if (result) {
            NSString *text = [result.bestTranscription.formattedString
              stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] ?: @"";
            if (text.length > 0) {
              strongSelf->_latestText = text;
              double confidence = [strongSelf averageConfidenceForTranscription:result.bestTranscription];
              if (confidence >= 0) {
                strongSelf->_latestConfidence = confidence;
                strongSelf->_hasConfidence = YES;
              }
              [strongSelf emitTranscriptForSessionId:sessionId isFinal:result.isFinal];
            }
            if (result.isFinal) {
              [strongSelf finishSession:sessionId
                                  state:text.length > 0 ? @"finished" : @"failed"
                           errorMessage:text.length > 0
                             ? nil
                             : @"음성에서 일정 텍스트를 찾지 못했습니다. 다시 말해 주세요."];
              return;
            }
          }

          if (error) {
            if (strongSelf->_stopRequested && strongSelf->_latestText.length > 0) {
              [strongSelf finishSession:sessionId state:@"finished" errorMessage:nil];
            } else {
              [strongSelf finishSession:sessionId
                                  state:@"failed"
                           errorMessage:@"음성 인식이 중단되었습니다. 마이크 상태와 기기 음성 인식 설정을 확인해 주세요."];
            }
          }
        });
      }];
      self->_recognitionTask = activeTask;

      [self->_audioEngine prepare];
      NSError *engineError = nil;
      [self->_audioEngine startAndReturnError:&engineError];
      if (engineError) {
        NSString *errorMessage = @"실시간 마이크 입력을 시작하지 못했습니다.";
        [self finishSession:sessionId state:@"failed" errorMessage:errorMessage];
        rejectPendingStart(@"live_speech_engine", errorMessage, engineError);
        return;
      }

      [self scheduleLevelEventsForSessionId:sessionId generation:sessionGeneration];
      [self scheduleDurationLimit:durationMillis
                        sessionId:sessionId
                       generation:sessionGeneration];
      [self emitState:@"listening" sessionId:sessionId message:nil];
      [self clearPendingStartForSessionId:sessionId generation:generation];
      resolve(@{ @"sessionId": sessionId });
      });
    }];
  });
#endif
}

RCT_REMAP_METHOD(stop,
                 stopSession:(NSString *)sessionId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(_sessionQueue, ^{
    if (![self->_sessionId isEqualToString:sessionId]) {
      reject(@"live_speech_session_mismatch", @"종료할 음성 인식 세션을 찾지 못했습니다.", nil);
      return;
    }
    if (self->_pendingStopResolve || self->_pendingStopReject) {
      reject(@"live_speech_stop_in_progress", @"이미 음성 인식을 마무리하고 있습니다.", nil);
      return;
    }
    self->_pendingStopResolve = resolve;
    self->_pendingStopReject = reject;
    [self beginStoppingSession:sessionId generation:self->_sessionGeneration];
  });
}

RCT_REMAP_METHOD(cancel,
                 cancelSession:(NSString *)sessionId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  dispatch_async(_sessionQueue, ^{
    [self cancelPendingStartForSessionId:sessionId
                                 message:@"음성 인식 시작을 취소했습니다."];
    if ([self->_sessionId isEqualToString:sessionId]) {
      [self finishSession:sessionId state:@"cancelled" errorMessage:nil];
    }
    resolve(nil);
  });
}

- (void)invalidate
{
  dispatch_sync(_sessionQueue, ^{
    if (self->_pendingStartSessionId.length > 0) {
      [self cancelPendingStartForSessionId:self->_pendingStartSessionId
                                   message:@"음성 인식 모듈이 종료되어 시작을 취소했습니다."];
    }
    if (self->_sessionId.length > 0) {
      [self finishSession:self->_sessionId state:@"cancelled" errorMessage:nil];
    }
  });
  [super invalidate];
}

@end

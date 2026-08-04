#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>
#import <Speech/Speech.h>
#import <TargetConditionals.h>
#import <math.h>
#import <stdatomic.h>

static NSString *const NoLateLiveSpeechTranscriptEvent = @"NoLateLiveSpeechTranscript";
static NSString *const NoLateLiveSpeechLevelEvent = @"NoLateLiveSpeechLevel";
static NSString *const NoLateLiveSpeechStateEvent = @"NoLateLiveSpeechState";
static NSString *const NoLateLiveSpeechErrorDomain = @"com.nolate.live-speech";
static NSString *const NoLateLiveSpeechAssistantErrorDomain = @"kAFAssistantErrorDomain";
static const NSTimeInterval NoLateLiveSpeechResetStartAdvanceSeconds = 0.35;
static const double NoLateLiveSpeechSubstantialShorteningRatio = 0.75;
static const NSUInteger NoLateLiveSpeechAlternativeLimit = 3;
static const NSInteger NoLateLiveSpeechNoSpeechErrorCode = 1110;

@interface NoLateLiveSpeech : RCTEventEmitter <RCTBridgeModule>
@end

@implementation NoLateLiveSpeech {
  dispatch_queue_t _sessionQueue;
  AVAudioEngine *_audioEngine;
  SFSpeechRecognizer *_speechRecognizer;
  SFSpeechAudioBufferRecognitionRequest *_recognitionRequest;
  SFSpeechRecognitionTask *_recognitionTask;
  NSArray<NSString *> *_contextualStrings;
  BOOL _requiresOnDeviceRecognition;
  NSUInteger _recognitionCycleGeneration;
  dispatch_source_t _durationTimer;
  dispatch_source_t _levelTimer;
  NSString *_sessionId;
  NSUInteger _sessionGeneration;
  NSString *_committedText;
  NSString *_currentHypothesisText;
  NSString *_previousRawText;
  NSTimeInterval _previousRawStartTime;
  NSTimeInterval _previousRawEndTime;
  NSString *_latestText;
  NSArray<NSDictionary *> *_latestAlternatives;
  double _latestConfidence;
  BOOL _hasConfidence;
  BOOL _didEmitFinalTranscript;
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
  if (_latestAlternatives.count > 0) body[@"alternatives"] = _latestAlternatives;
  return body;
}

- (void)emitTranscriptForSessionId:(NSString *)sessionId isFinal:(BOOL)isFinal
{
  if (sessionId.length == 0) return;
  if (isFinal) _didEmitFinalTranscript = YES;
  [self emitEvent:NoLateLiveSpeechTranscriptEvent
             body:[self resultBodyForSessionId:sessionId isFinal:isFinal]];
}

- (double)averageConfidenceForTranscription:(SFTranscription *)transcription
{
  if (transcription.segments.count == 0) return -1;
  double total = 0;
  NSUInteger measuredCount = 0;
  for (SFTranscriptionSegment *segment in transcription.segments) {
    double confidence = segment.confidence;
    // SFSpeech can return 0 when it has not produced a calibrated confidence value.
    if (!isfinite(confidence) || confidence <= 0) continue;
    total += confidence;
    measuredCount += 1;
  }
  return measuredCount > 0 ? total / measuredCount : -1;
}

- (NSString *)normalizedTranscriptText:(NSString *)text
{
  if (![text isKindOfClass:NSString.class]) return @"";
  NSArray<NSString *> *components = [text
    componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSMutableArray<NSString *> *words = [NSMutableArray arrayWithCapacity:components.count];
  for (NSString *component in components) {
    if (component.length > 0) [words addObject:component];
  }
  return [words componentsJoinedByString:@" "];
}

- (NSString *)comparisonTextForTranscript:(NSString *)text
{
  NSMutableCharacterSet *ignoredCharacters = [NSCharacterSet.whitespaceAndNewlineCharacterSet mutableCopy];
  [ignoredCharacters formUnionWithCharacterSet:NSCharacterSet.punctuationCharacterSet];
  return [[text componentsSeparatedByCharactersInSet:ignoredCharacters]
    componentsJoinedByString:@""];
}

- (NSUInteger)commonPrefixLengthBetween:(NSString *)first second:(NSString *)second
{
  NSUInteger maximumLength = MIN(first.length, second.length);
  NSUInteger length = 0;
  while (length < maximumLength
         && [first characterAtIndex:length] == [second characterAtIndex:length]) {
    length += 1;
  }
  return length;
}

- (NSUInteger)commonSuffixLengthBetween:(NSString *)first second:(NSString *)second
{
  NSUInteger maximumLength = MIN(first.length, second.length);
  NSUInteger length = 0;
  while (length < maximumLength
         && [first characterAtIndex:first.length - length - 1]
           == [second characterAtIndex:second.length - length - 1]) {
    length += 1;
  }
  return length;
}

- (BOOL)isLikelyRevisionFromText:(NSString *)previousText toText:(NSString *)incomingText
{
  NSString *previous = [self comparisonTextForTranscript:previousText];
  NSString *incoming = [self comparisonTextForTranscript:incomingText];
  if (previous.length == 0 || incoming.length == 0) return NO;
  if ([previous isEqualToString:incoming]
      || [previous containsString:incoming]
      || [incoming containsString:previous]) {
    return YES;
  }

  NSUInteger shorterLength = MIN(previous.length, incoming.length);
  NSUInteger stableLength = MAX(
    [self commonPrefixLengthBetween:previous second:incoming],
    [self commonSuffixLengthBetween:previous second:incoming]
  );
  return stableLength >= 4 || (shorterLength > 0 && stableLength * 2 >= shorterLength);
}

- (NSString *)textByAppendingTranscript:(NSString *)incomingText
                                toPrefix:(NSString *)prefixText
{
  NSString *prefix = [self normalizedTranscriptText:prefixText];
  NSString *incoming = [self normalizedTranscriptText:incomingText];
  if (prefix.length == 0) return incoming;
  if (incoming.length == 0) return prefix;
  if ([prefix isEqualToString:incoming]
      || [prefix hasSuffix:incoming]) {
    return prefix;
  }
  if ([incoming hasPrefix:prefix]) return incoming;

  NSUInteger maximumOverlap = MIN(prefix.length, incoming.length);
  for (NSUInteger overlap = maximumOverlap; overlap >= 2; overlap -= 1) {
    NSString *prefixSuffix = [prefix substringFromIndex:prefix.length - overlap];
    NSString *incomingPrefix = [incoming substringToIndex:overlap];
    if ([prefixSuffix isEqualToString:incomingPrefix]) {
      NSString *remainder = [incoming substringFromIndex:overlap];
      return [self normalizedTranscriptText:[prefix stringByAppendingString:remainder]];
    }
  }
  return [NSString stringWithFormat:@"%@ %@", prefix, incoming];
}

- (NSTimeInterval)startTimeForTranscription:(SFTranscription *)transcription
{
  SFTranscriptionSegment *firstSegment = transcription.segments.firstObject;
  return firstSegment ? firstSegment.timestamp : -1;
}

- (NSTimeInterval)endTimeForTranscription:(SFTranscription *)transcription
{
  SFTranscriptionSegment *lastSegment = transcription.segments.lastObject;
  return lastSegment ? lastSegment.timestamp + lastSegment.duration : -1;
}

- (BOOL)incomingTranscriptionStartsNewUtterance:(SFTranscription *)transcription
                                           text:(NSString *)text
{
  if (_previousRawText.length == 0 || _currentHypothesisText.length == 0) return NO;
  NSTimeInterval startTime = [self startTimeForTranscription:transcription];
  if (startTime < 0 || _previousRawStartTime < 0) return NO;

  BOOL startMovedForward = startTime
    > _previousRawStartTime + NoLateLiveSpeechResetStartAdvanceSeconds;
  if (!startMovedForward) return NO;

  NSString *previousComparison = [self comparisonTextForTranscript:_previousRawText];
  NSString *incomingComparison = [self comparisonTextForTranscript:text];
  BOOL substantiallyShorter = incomingComparison.length
    < previousComparison.length * NoLateLiveSpeechSubstantialShorteningRatio;
  BOOL startsAfterPreviousTail = _previousRawEndTime >= 0
    && startTime >= _previousRawEndTime - NoLateLiveSpeechResetStartAdvanceSeconds;
  return substantiallyShorter
    || startsAfterPreviousTail
    || ![self isLikelyRevisionFromText:_previousRawText toText:text];
}

- (BOOL)incomingTranscriptionRestoresEarlierContext:(SFTranscription *)transcription
                                               text:(NSString *)text
                                            isFinal:(BOOL)isFinal
{
  if (_committedText.length == 0 || _latestText.length == 0) return NO;
  NSTimeInterval startTime = [self startTimeForTranscription:transcription];
  if (startTime < 0 || _previousRawStartTime < 0) return NO;

  BOOL startMovedBackward = startTime + NoLateLiveSpeechResetStartAdvanceSeconds
    < _previousRawStartTime;
  if (!startMovedBackward) return NO;

  NSString *incomingComparison = [self comparisonTextForTranscript:text];
  NSString *latestComparison = [self comparisonTextForTranscript:_latestText];
  BOOL hasComparableCoverage = incomingComparison.length
    >= latestComparison.length * NoLateLiveSpeechSubstantialShorteningRatio;
  return isFinal
    || hasComparableCoverage
    || [self isLikelyRevisionFromText:_latestText toText:text];
}

- (NSString *)preferredCurrentHypothesisForIncomingText:(NSString *)incomingText
                                                isFinal:(BOOL)isFinal
{
  if (_currentHypothesisText.length == 0 || isFinal) return incomingText;
  if (incomingText.length >= _currentHypothesisText.length) return incomingText;
  if ([_currentHypothesisText containsString:incomingText]
      || [_currentHypothesisText hasPrefix:incomingText]) {
    return _currentHypothesisText;
  }

  NSString *currentComparison = [self comparisonTextForTranscript:_currentHypothesisText];
  NSString *incomingComparison = [self comparisonTextForTranscript:incomingText];
  if ([self isLikelyRevisionFromText:_currentHypothesisText toText:incomingText]
      && incomingComparison.length
        >= currentComparison.length * NoLateLiveSpeechSubstantialShorteningRatio) {
    return incomingText;
  }
  return _currentHypothesisText;
}

- (NSArray<NSDictionary *> *)alternativesForResult:(SFSpeechRecognitionResult *)result
{
  NSMutableArray<NSDictionary *> *alternatives = [NSMutableArray
    arrayWithCapacity:NoLateLiveSpeechAlternativeLimit];
  NSMutableSet<NSString *> *seenTexts = [NSMutableSet
    setWithCapacity:NoLateLiveSpeechAlternativeLimit];

  if (_latestText.length > 0) {
    NSMutableDictionary *best = [@{ @"text": _latestText } mutableCopy];
    if (_hasConfidence) {
      best[@"confidence"] = @(MIN(1.0, MAX(0.0, _latestConfidence)));
    }
    [alternatives addObject:best];
    [seenTexts addObject:_latestText];
  }

  for (SFTranscription *transcription in result.transcriptions) {
    if (alternatives.count >= NoLateLiveSpeechAlternativeLimit) break;
    NSString *rawText = [self normalizedTranscriptText:transcription.formattedString];
    NSTimeInterval candidateStartTime = [self startTimeForTranscription:transcription];
    BOOL candidateIncludesEarlierContext = _committedText.length > 0
      && candidateStartTime >= 0
      && _previousRawStartTime >= 0
      && candidateStartTime + NoLateLiveSpeechResetStartAdvanceSeconds
        < _previousRawStartTime;
    NSString *candidateText = candidateIncludesEarlierContext
      ? rawText
      : [self textByAppendingTranscript:rawText toPrefix:_committedText];
    if (candidateText.length == 0 || [seenTexts containsObject:candidateText]) continue;

    NSMutableDictionary *candidate = [@{ @"text": candidateText } mutableCopy];
    double confidence = [self averageConfidenceForTranscription:transcription];
    if (confidence >= 0) candidate[@"confidence"] = @(MIN(1.0, MAX(0.0, confidence)));
    [alternatives addObject:candidate];
    [seenTexts addObject:candidateText];
  }
  return alternatives;
}

- (BOOL)updateTranscriptStateWithResult:(SFSpeechRecognitionResult *)result
{
  SFTranscription *bestTranscription = result.bestTranscription;
  NSString *incomingText = [self normalizedTranscriptText:bestTranscription.formattedString];
  if (incomingText.length == 0) return _latestText.length > 0;

  BOOL beginsAfterCommittedCycle = _committedText.length > 0
    && _currentHypothesisText.length == 0;
  BOOL restoresEarlierContext = [self
    incomingTranscriptionRestoresEarlierContext:bestTranscription
                                           text:incomingText
                                        isFinal:result.isFinal];
  BOOL startsNewUtterance = !restoresEarlierContext
    && [self incomingTranscriptionStartsNewUtterance:bestTranscription text:incomingText];
  BOOL acceptedIncomingText = YES;
  if (restoresEarlierContext) {
    _currentHypothesisText = _latestText;
    _committedText = @"";
    NSString *preferredText = [self preferredCurrentHypothesisForIncomingText:incomingText
                                                                       isFinal:result.isFinal];
    acceptedIncomingText = [preferredText isEqualToString:incomingText];
    _currentHypothesisText = preferredText;
  } else if (startsNewUtterance) {
    _committedText = [self textByAppendingTranscript:_currentHypothesisText
                                           toPrefix:_committedText];
    _currentHypothesisText = incomingText;
  } else {
    NSString *preferredText = [self preferredCurrentHypothesisForIncomingText:incomingText
                                                                       isFinal:result.isFinal];
    acceptedIncomingText = [preferredText isEqualToString:incomingText];
    _currentHypothesisText = preferredText;
  }

  _latestText = [self textByAppendingTranscript:_currentHypothesisText
                                       toPrefix:_committedText];
  _previousRawText = incomingText;
  _previousRawStartTime = [self startTimeForTranscription:bestTranscription];
  _previousRawEndTime = [self endTimeForTranscription:bestTranscription];

  double confidence = [self averageConfidenceForTranscription:bestTranscription];
  if (confidence >= 0 && (acceptedIncomingText || !_hasConfidence)) {
    _latestConfidence = (startsNewUtterance || beginsAfterCommittedCycle) && _hasConfidence
      ? MIN(_latestConfidence, confidence)
      : confidence;
    _hasConfidence = YES;
  }
  _latestAlternatives = [self alternativesForResult:result];
  return _latestText.length > 0;
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
  _contextualStrings = nil;
  _requiresOnDeviceRecognition = NO;
  _recognitionCycleGeneration += 1;
  _sessionId = nil;
  _sessionGeneration += 1;
  _committedText = nil;
  _currentHypothesisText = nil;
  _previousRawText = nil;
  _previousRawStartTime = -1;
  _previousRawEndTime = -1;
  _latestText = nil;
  _latestAlternatives = nil;
  _latestConfidence = 0;
  _hasConfidence = NO;
  _didEmitFinalTranscript = NO;
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

  if (!cancelled && hasText && !_didEmitFinalTranscript) {
    [self emitTranscriptForSessionId:sessionId isFinal:YES];
  }
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

- (SFSpeechAudioBufferRecognitionRequest *)newRecognitionRequest
{
  SFSpeechAudioBufferRecognitionRequest *request =
    [SFSpeechAudioBufferRecognitionRequest new];
  request.shouldReportPartialResults = YES;
  request.taskHint = SFSpeechRecognitionTaskHintDictation;
  request.contextualStrings = _contextualStrings ?: @[];
  if (@available(iOS 16.0, *)) request.addsPunctuation = YES;
  if (@available(iOS 13.0, *)) {
    request.requiresOnDeviceRecognition = _requiresOnDeviceRecognition;
  }
  return request;
}

- (void)stopCurrentRecognitionCycle
{
  AVAudioEngine *audioEngine = _audioEngine;
  if (audioEngine.isRunning) [audioEngine stop];
  @try {
    [audioEngine.inputNode removeTapOnBus:0];
  } @catch (__unused NSException *exception) {
  }
  [_recognitionRequest endAudio];
  _audioEngine = nil;
  _recognitionRequest = nil;
}

- (void)prepareTranscriptForNextRecognitionCycle
{
  _committedText = _latestText ?: @"";
  _currentHypothesisText = @"";
  _previousRawText = @"";
  _previousRawStartTime = -1;
  _previousRawEndTime = -1;
}

- (BOOL)isRecoverableSilenceError:(NSError *)error
{
  return error != nil
    && error.code == NoLateLiveSpeechNoSpeechErrorCode
    && [error.domain isEqualToString:NoLateLiveSpeechAssistantErrorDomain];
}

- (BOOL)startRecognitionCycleForSessionId:(NSString *)sessionId
                               generation:(NSUInteger)sessionGeneration
                                errorCode:(NSString **)errorCode
                                    error:(NSError **)error
{
  if (![self isActiveSessionId:sessionId generation:sessionGeneration]
      || _stopRequested
      || !_speechRecognizer) {
    if (errorCode) *errorCode = @"live_speech_session_mismatch";
    if (error) {
      *error = [NSError errorWithDomain:NoLateLiveSpeechErrorDomain
                                  code:1
                              userInfo:@{
                                NSLocalizedDescriptionKey:
                                  @"계속할 음성 인식 세션을 찾지 못했습니다.",
                              }];
    }
    return NO;
  }

  NSUInteger recognitionCycleGeneration = ++_recognitionCycleGeneration;
  SFSpeechAudioBufferRecognitionRequest *request = [self newRecognitionRequest];
  AVAudioEngine *audioEngine = [AVAudioEngine new];
  AVAudioInputNode *inputNode = audioEngine.inputNode;
  AVAudioFormat *inputFormat = [inputNode outputFormatForBus:0];
  if (inputFormat.sampleRate <= 0 || inputFormat.channelCount == 0) {
    if (errorCode) *errorCode = @"live_speech_input_format";
    if (error) {
      *error = [NSError errorWithDomain:NoLateLiveSpeechErrorDomain
                                  code:2
                              userInfo:@{
                                NSLocalizedDescriptionKey:
                                  @"마이크 입력 형식을 확인하지 못했습니다.",
                              }];
    }
    return NO;
  }

  _audioEngine = audioEngine;
  _recognitionRequest = request;
  __weak typeof(self) weakSelf = self;
  [inputNode installTapOnBus:0
                  bufferSize:1024
                      format:inputFormat
                       block:^(AVAudioPCMBuffer *buffer, __unused AVAudioTime *when) {
    [request appendAudioPCMBuffer:buffer];
    [weakSelf captureLevelForBuffer:buffer];
  }];

  __block __weak SFSpeechRecognitionTask *activeTask = nil;
  activeTask = [_speechRecognizer recognitionTaskWithRequest:request
                                               resultHandler:^(SFSpeechRecognitionResult *result,
                                                               NSError *recognitionError) {
    typeof(self) queuedSelf = weakSelf;
    if (!queuedSelf) return;
    dispatch_async(queuedSelf->_sessionQueue, ^{
      typeof(self) strongSelf = queuedSelf;
      if (!strongSelf
          || strongSelf->_sessionGeneration != sessionGeneration
          || strongSelf->_recognitionCycleGeneration != recognitionCycleGeneration
          || strongSelf->_recognitionTask != activeTask
          || ![strongSelf->_sessionId isEqualToString:sessionId]) return;

      if (result) {
        BOOL hasText = [strongSelf updateTranscriptStateWithResult:result];
        BOOL shouldContinue = result.isFinal
          && !strongSelf->_stopRequested
          && (recognitionError == nil
              || [strongSelf isRecoverableSilenceError:recognitionError]);
        if (hasText) {
          [strongSelf emitTranscriptForSessionId:sessionId
                                        isFinal:result.isFinal && !shouldContinue];
        }

        if (result.isFinal) {
          if (shouldContinue) {
            [strongSelf stopCurrentRecognitionCycle];
            [strongSelf prepareTranscriptForNextRecognitionCycle];

            NSError *rolloverError = nil;
            if (![strongSelf startRecognitionCycleForSessionId:sessionId
                                                    generation:sessionGeneration
                                                     errorCode:NULL
                                                         error:&rolloverError]) {
              NSString *message = rolloverError.localizedDescription.length > 0
                ? rolloverError.localizedDescription
                : @"음성 인식을 계속하지 못했습니다. 다시 시도해 주세요.";
              [strongSelf finishSession:sessionId
                                  state:@"failed"
                           errorMessage:message];
            }
          } else {
            [strongSelf finishSession:sessionId
                                state:hasText ? @"finished" : @"failed"
                         errorMessage:hasText
                           ? nil
                           : @"음성에서 일정 텍스트를 찾지 못했습니다. 다시 말해 주세요."];
          }
          return;
        }
      }

      if (recognitionError) {
        if (!strongSelf->_stopRequested
            && [strongSelf isRecoverableSilenceError:recognitionError]) {
          [strongSelf stopCurrentRecognitionCycle];
          [strongSelf prepareTranscriptForNextRecognitionCycle];

          NSError *rolloverError = nil;
          if (![strongSelf startRecognitionCycleForSessionId:sessionId
                                                  generation:sessionGeneration
                                                   errorCode:NULL
                                                       error:&rolloverError]) {
            NSString *message = rolloverError.localizedDescription.length > 0
              ? rolloverError.localizedDescription
              : @"음성 인식을 계속하지 못했습니다. 다시 시도해 주세요.";
            [strongSelf finishSession:sessionId
                                state:@"failed"
                         errorMessage:message];
          }
        } else if (strongSelf->_stopRequested && strongSelf->_latestText.length > 0) {
          [strongSelf finishSession:sessionId state:@"finished" errorMessage:nil];
        } else {
          [strongSelf finishSession:sessionId
                              state:@"failed"
                       errorMessage:@"음성 인식이 중단되었습니다. 마이크 상태와 기기 음성 인식 설정을 확인해 주세요."];
        }
      }
    });
  }];
  if (!activeTask) {
    _recognitionCycleGeneration += 1;
    [self stopCurrentRecognitionCycle];
    if (errorCode) *errorCode = @"live_speech_task";
    if (error) {
      *error = [NSError errorWithDomain:NoLateLiveSpeechErrorDomain
                                  code:3
                              userInfo:@{
                                NSLocalizedDescriptionKey:
                                  @"음성 인식 작업을 시작하지 못했습니다.",
                              }];
    }
    return NO;
  }
  _recognitionTask = activeTask;

  [audioEngine prepare];
  NSError *engineError = nil;
  [audioEngine startAndReturnError:&engineError];
  if (engineError) {
    _recognitionCycleGeneration += 1;
    [activeTask cancel];
    [self stopCurrentRecognitionCycle];
    _recognitionTask = nil;
    if (errorCode) *errorCode = @"live_speech_engine";
    if (error) *error = engineError;
    return NO;
  }
  return YES;
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
      self->_committedText = @"";
      self->_currentHypothesisText = @"";
      self->_previousRawText = @"";
      self->_previousRawStartTime = -1;
      self->_previousRawEndTime = -1;
      self->_latestText = @"";
      self->_latestAlternatives = @[];
      self->_latestConfidence = 0;
      self->_hasConfidence = NO;
      self->_didEmitFinalTranscript = NO;
      self->_stopRequested = NO;
      self->_startedAt = CACurrentMediaTime();
      self->_speechRecognizer = recognizer;
      self->_contextualStrings = [self normalizedContextFromOptions:startOptions];
      self->_requiresOnDeviceRecognition = requiresOnDeviceRecognition;

      NSString *recognitionErrorCode = nil;
      NSError *recognitionError = nil;
      if (![self startRecognitionCycleForSessionId:sessionId
                                        generation:sessionGeneration
                                         errorCode:&recognitionErrorCode
                                             error:&recognitionError]) {
        NSString *errorMessage = recognitionError.localizedDescription.length > 0
          ? recognitionError.localizedDescription
          : @"실시간 마이크 입력을 시작하지 못했습니다.";
        [self finishSession:sessionId state:@"failed" errorMessage:errorMessage];
        rejectPendingStart(recognitionErrorCode ?: @"live_speech_engine",
                           errorMessage,
                           recognitionError);
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

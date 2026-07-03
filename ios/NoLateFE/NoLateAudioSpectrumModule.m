#import <Accelerate/Accelerate.h>
#import <AVFoundation/AVFoundation.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface NoLateAudioSpectrum : RCTEventEmitter <RCTBridgeModule>
@end

@implementation NoLateAudioSpectrum {
  AVAudioEngine *_engine;
  dispatch_queue_t _analysisQueue;
  BOOL _hasListeners;
  BOOL _isRunning;
  NSInteger _bandCount;
  CFTimeInterval _lastEmitTime;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _engine = [AVAudioEngine new];
    _analysisQueue = dispatch_queue_create("com.nolate.audio-spectrum.analysis", DISPATCH_QUEUE_SERIAL);
    _bandCount = 36;
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"NoLateAudioSpectrumData" ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

RCT_REMAP_METHOD(start,
                 startWithBandCount:(nonnull NSNumber *)requestedBandCount
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(_analysisQueue, ^{
    @try {
      if (self->_isRunning) {
        [self stopInternal];
      }

      self->_bandCount = MAX(12, MIN(72, requestedBandCount.integerValue));
      self->_lastEmitTime = 0;

      AVAudioSession *session = [AVAudioSession sharedInstance];
      NSError *sessionError = nil;
      [session setCategory:AVAudioSessionCategoryPlayAndRecord
                      mode:AVAudioSessionModeMeasurement
                   options:AVAudioSessionCategoryOptionDefaultToSpeaker |
                           AVAudioSessionCategoryOptionAllowBluetooth |
                           AVAudioSessionCategoryOptionMixWithOthers
                     error:&sessionError];
      if (sessionError) {
        @throw [NSException exceptionWithName:@"NoLateAudioSpectrumSession"
                                       reason:sessionError.localizedDescription
                                     userInfo:nil];
      }

      [session setActive:YES error:&sessionError];
      if (sessionError) {
        @throw [NSException exceptionWithName:@"NoLateAudioSpectrumSession"
                                       reason:sessionError.localizedDescription
                                     userInfo:nil];
      }

      AVAudioInputNode *inputNode = self->_engine.inputNode;
      AVAudioFormat *inputFormat = [inputNode inputFormatForBus:0];
      [inputNode removeTapOnBus:0];

      __weak typeof(self) weakSelf = self;
      [inputNode installTapOnBus:0
                      bufferSize:1024
                          format:inputFormat
                           block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
        [weakSelf handleAudioBuffer:buffer];
      }];

      [self->_engine prepare];
      NSError *engineError = nil;
      [self->_engine startAndReturnError:&engineError];
      if (engineError) {
        @throw [NSException exceptionWithName:@"NoLateAudioSpectrumEngine"
                                       reason:engineError.localizedDescription
                                     userInfo:nil];
      }

      self->_isRunning = YES;
      dispatch_async(dispatch_get_main_queue(), ^{
        resolve(@{ @"running": @YES });
      });
    } @catch (NSException *exception) {
      [self stopInternal];
      NSError *error = [NSError errorWithDomain:@"NoLateAudioSpectrum"
                                           code:1
                                       userInfo:@{ NSLocalizedDescriptionKey: exception.reason ?: @"Failed to start native audio spectrum." }];
      dispatch_async(dispatch_get_main_queue(), ^{
        reject(@"audio_spectrum_start_failed", @"Failed to start native audio spectrum.", error);
      });
    }
  });
}

RCT_EXPORT_METHOD(stop)
{
  dispatch_async(_analysisQueue, ^{
    [self stopInternal];
  });
}

- (void)stopInternal
{
  if (_engine.isRunning) {
    [_engine stop];
  }

  [_engine.inputNode removeTapOnBus:0];
  _isRunning = NO;
}

- (void)handleAudioBuffer:(AVAudioPCMBuffer *)buffer
{
  CFTimeInterval now = CACurrentMediaTime();
  if (now - _lastEmitTime < 1.0 / 30.0) {
    return;
  }
  _lastEmitTime = now;

  float **channelData = buffer.floatChannelData;
  if (channelData == NULL || buffer.frameLength == 0) {
    return;
  }

  NSInteger frameLength = (NSInteger)buffer.frameLength;
  NSInteger channelCount = MAX(1, (NSInteger)buffer.format.channelCount);
  NSMutableData *sampleData = [NSMutableData dataWithLength:sizeof(float) * frameLength];
  float *samples = (float *)sampleData.mutableBytes;

  for (NSInteger frameIndex = 0; frameIndex < frameLength; frameIndex++) {
    float mixedSample = 0;
    for (NSInteger channelIndex = 0; channelIndex < channelCount; channelIndex++) {
      mixedSample += channelData[channelIndex][frameIndex];
    }
    samples[frameIndex] = mixedSample / (float)channelCount;
  }

  NSData *copiedSamples = [sampleData copy];
  NSInteger requestedCount = _bandCount;
  float sampleRate = (float)buffer.format.sampleRate;

  dispatch_async(_analysisQueue, ^{
    const float *copiedPointer = (const float *)copiedSamples.bytes;
    NSArray<NSNumber *> *waveform = [self waveformLevelsFromSamples:copiedPointer
                                                              length:frameLength
                                                               count:requestedCount];
    NSArray<NSNumber *> *bands = [self frequencyBandsFromSamples:copiedPointer
                                                          length:frameLength
                                                           count:requestedCount
                                                      sampleRate:sampleRate];
    float rms = [self rmsFromSamples:copiedPointer length:frameLength];
    float peak = [self peakFromSamples:copiedPointer length:frameLength];

    dispatch_async(dispatch_get_main_queue(), ^{
      if (!self->_hasListeners) {
        return;
      }

      [self sendEventWithName:@"NoLateAudioSpectrumData"
                         body:@{
                           @"waveform": waveform,
                           @"bands": bands,
                           @"rms": @(MIN(1.0, rms * 9.0)),
                           @"peak": @(MIN(1.0, peak * 5.0)),
                           @"timestamp": @(CACurrentMediaTime()),
                         }];
    });
  });
}

- (float)rmsFromSamples:(const float *)samples length:(NSInteger)length
{
  if (length <= 0) {
    return 0;
  }

  float rms = 0;
  vDSP_rmsqv(samples, 1, &rms, (vDSP_Length)length);
  return MAX(0, rms);
}

- (float)peakFromSamples:(const float *)samples length:(NSInteger)length
{
  if (length <= 0) {
    return 0;
  }

  float peak = 0;
  vDSP_maxmgv(samples, 1, &peak, (vDSP_Length)length);
  return MAX(0, peak);
}

- (NSArray<NSNumber *> *)waveformLevelsFromSamples:(const float *)samples
                                            length:(NSInteger)length
                                             count:(NSInteger)count
{
  if (length <= 0 || count <= 0) {
    return @[];
  }

  NSInteger segmentSize = MAX(1, length / count);
  NSMutableArray<NSNumber *> *levels = [NSMutableArray arrayWithCapacity:(NSUInteger)count];

  for (NSInteger index = 0; index < count; index++) {
    NSInteger start = MIN(length - 1, index * segmentSize);
    NSInteger end = MIN(length, start + segmentSize);
    float maxMagnitude = 0;

    for (NSInteger sampleIndex = start; sampleIndex < end; sampleIndex++) {
      maxMagnitude = MAX(maxMagnitude, fabsf(samples[sampleIndex]));
    }

    float normalized = MIN(1.0, powf(maxMagnitude * 5.4, 0.72));
    [levels addObject:@(normalized)];
  }

  return levels;
}

- (NSArray<NSNumber *> *)frequencyBandsFromSamples:(const float *)samples
                                            length:(NSInteger)length
                                             count:(NSInteger)count
                                        sampleRate:(float)sampleRate
{
  NSInteger fftSize = MIN(2048, [self previousPowerOfTwo:length]);
  if (fftSize < 128 || count <= 0) {
    return [self waveformLevelsFromSamples:samples length:length count:count];
  }

  float *real = calloc((size_t)fftSize, sizeof(float));
  float *imaginary = calloc((size_t)fftSize, sizeof(float));
  float *outputReal = calloc((size_t)fftSize, sizeof(float));
  float *outputImaginary = calloc((size_t)fftSize, sizeof(float));
  float *window = calloc((size_t)fftSize, sizeof(float));
  float *magnitudes = calloc((size_t)(fftSize / 2), sizeof(float));

  if (!real || !imaginary || !outputReal || !outputImaginary || !window || !magnitudes) {
    free(real);
    free(imaginary);
    free(outputReal);
    free(outputImaginary);
    free(window);
    free(magnitudes);
    return [self waveformLevelsFromSamples:samples length:length count:count];
  }

  memcpy(real, samples, sizeof(float) * (size_t)fftSize);
  vDSP_hann_window(window, (vDSP_Length)fftSize, vDSP_HANN_NORM);
  vDSP_vmul(real, 1, window, 1, real, 1, (vDSP_Length)fftSize);

  vDSP_DFT_Setup setup = vDSP_DFT_zop_CreateSetup(NULL, (vDSP_Length)fftSize, vDSP_DFT_FORWARD);
  if (!setup) {
    free(real);
    free(imaginary);
    free(outputReal);
    free(outputImaginary);
    free(window);
    free(magnitudes);
    return [self waveformLevelsFromSamples:samples length:length count:count];
  }

  vDSP_DFT_Execute(setup, real, imaginary, outputReal, outputImaginary);
  vDSP_DFT_DestroySetup(setup);

  DSPSplitComplex splitComplex;
  splitComplex.realp = outputReal;
  splitComplex.imagp = outputImaginary;
  vDSP_zvabs(&splitComplex, 1, magnitudes, 1, (vDSP_Length)(fftSize / 2));

  float nyquist = MAX(1, sampleRate / 2.0);
  float lowFrequency = 80.0;
  float highFrequency = MIN(8200.0, nyquist);
  float frequencyRatio = highFrequency / lowFrequency;
  NSInteger magnitudeCount = fftSize / 2;
  NSInteger maxBin = MAX(3, magnitudeCount - 1);
  NSMutableArray<NSNumber *> *levels = [NSMutableArray arrayWithCapacity:(NSUInteger)count];

  for (NSInteger index = 0; index < count; index++) {
    float startRatio = (float)index / (float)count;
    float endRatio = (float)(index + 1) / (float)count;
    float startFrequency = lowFrequency * powf(frequencyRatio, startRatio);
    float endFrequency = lowFrequency * powf(frequencyRatio, endRatio);
    NSInteger startBin = MAX(1, MIN(maxBin, (NSInteger)((startFrequency / nyquist) * (float)magnitudeCount)));
    NSInteger endBin = MAX(startBin + 1, MIN(maxBin, (NSInteger)((endFrequency / nyquist) * (float)magnitudeCount)));
    float maxMagnitude = 0;

    for (NSInteger bin = startBin; bin < endBin; bin++) {
      maxMagnitude = MAX(maxMagnitude, magnitudes[bin]);
    }

    float scaled = maxMagnitude / (float)fftSize;
    float normalized = MIN(1.0, powf(scaled * 95.0, 0.58));
    [levels addObject:@(normalized)];
  }

  free(real);
  free(imaginary);
  free(outputReal);
  free(outputImaginary);
  free(window);
  free(magnitudes);

  return levels;
}

- (NSInteger)previousPowerOfTwo:(NSInteger)value
{
  if (value <= 0) {
    return 0;
  }

  NSInteger power = 1;
  while (power * 2 <= value) {
    power *= 2;
  }
  return power;
}

@end

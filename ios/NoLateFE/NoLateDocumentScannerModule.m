#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <VisionKit/VisionKit.h>
#import <math.h>

@interface NoLateDocumentScanner : NSObject <RCTBridgeModule, VNDocumentCameraViewControllerDelegate>
@end

@implementation NoLateDocumentScanner {
  dispatch_queue_t _imageQueue;
  VNDocumentCameraViewController *_scannerViewController;
  RCTPromiseResolveBlock _scanResolve;
  RCTPromiseRejectBlock _scanReject;
  NSUInteger _maxPages;
  CGFloat _jpegQuality;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  if (self = [super init]) {
    _imageQueue = dispatch_queue_create("com.nolate.document-scanner.images", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (void)clearActiveScanner
{
  _scannerViewController.delegate = nil;
  _scannerViewController = nil;
  _scanResolve = nil;
  _scanReject = nil;
  _maxPages = 0;
  _jpegQuality = 0;
}

- (NSURL *)scanRootDirectory
{
  NSURL *cacheDirectory = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory
                                                               inDomains:NSUserDomainMask].firstObject;
  if (!cacheDirectory) return nil;

  return [cacheDirectory URLByAppendingPathComponent:@"quick-schedule-scans"
                                          isDirectory:YES];
}

- (NSURL *)newScanDirectoryWithError:(NSError **)error
{
  NSURL *scanRoot = [self scanRootDirectory];
  if (!scanRoot) return nil;

  NSURL *scanDirectory = [scanRoot URLByAppendingPathComponent:NSUUID.UUID.UUIDString.lowercaseString
                                                   isDirectory:YES];
  if (![NSFileManager.defaultManager createDirectoryAtURL:scanDirectory
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:error]) {
    return nil;
  }
  return scanDirectory;
}

- (void)resolveCancelledFromController:(VNDocumentCameraViewController *)controller
{
  RCTPromiseResolveBlock resolve = _scanResolve;
  [self clearActiveScanner];
  [controller dismissViewControllerAnimated:YES completion:^{
    if (resolve) resolve(@{ @"cancelled": @YES, @"pages": @[] });
  }];
}

- (void)rejectFromController:(VNDocumentCameraViewController *)controller
                        code:(NSString *)code
                     message:(NSString *)message
                       error:(NSError *)error
{
  RCTPromiseRejectBlock reject = _scanReject;
  [self clearActiveScanner];
  [controller dismissViewControllerAnimated:YES completion:^{
    if (reject) reject(code, message, error);
  }];
}

RCT_REMAP_METHOD(isSupported,
                 isSupportedWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  resolve(@(VNDocumentCameraViewController.isSupported));
}

RCT_REMAP_METHOD(scan,
                 scanWithOptions:(NSDictionary *)options
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!VNDocumentCameraViewController.isSupported) {
    reject(@"document_scan_unsupported",
           @"이 기기에서는 문서 스캔을 사용할 수 없습니다. 사진 촬영을 이용해 주세요.",
           nil);
    return;
  }
  if (_scannerViewController || _scanResolve) {
    reject(@"document_scan_in_progress", @"이미 문서 스캔이 진행 중입니다.", nil);
    return;
  }

  UIViewController *presenter = RCTPresentedViewController();
  if (!presenter || !presenter.view.window) {
    reject(@"document_scan_presenter", @"문서 스캐너를 표시할 화면을 찾지 못했습니다.", nil);
    return;
  }

  NSInteger requestedMaxPages = [options[@"maxPages"] respondsToSelector:@selector(integerValue)]
      ? [options[@"maxPages"] integerValue]
      : 3;
  double requestedQuality = [options[@"jpegQuality"] respondsToSelector:@selector(doubleValue)]
      ? [options[@"jpegQuality"] doubleValue]
      : 0.94;
  _maxPages = (NSUInteger)MIN(10, MAX(1, requestedMaxPages));
  _jpegQuality = (CGFloat)MIN(1.0, MAX(0.7, requestedQuality));
  _scanResolve = [resolve copy];
  _scanReject = [reject copy];
  _scannerViewController = [VNDocumentCameraViewController new];
  _scannerViewController.delegate = self;
  _scannerViewController.modalPresentationStyle = UIModalPresentationFullScreen;

  [presenter presentViewController:_scannerViewController animated:YES completion:nil];
}

RCT_REMAP_METHOD(discard,
                 discardPages:(NSArray<NSString *> *)uris
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  NSArray<NSString *> *requestedURIs = [uris isKindOfClass:NSArray.class] ? [uris copy] : @[];
  dispatch_async(_imageQueue, ^{
    NSURL *scanRoot = self.scanRootDirectory.standardizedURL;
    NSString *rootPrefix = scanRoot.path.length > 0
      ? [scanRoot.path stringByAppendingString:@"/"]
      : @"";
    NSMutableSet<NSString *> *directories = [NSMutableSet set];

    for (id value in requestedURIs) {
      if (![value isKindOfClass:NSString.class]) continue;
      NSURL *pageURL = [NSURL URLWithString:(NSString *)value];
      if (!pageURL.isFileURL) continue;
      NSString *directoryPath = pageURL.URLByDeletingLastPathComponent.standardizedURL.path;
      if (rootPrefix.length > 0 && [directoryPath hasPrefix:rootPrefix]) {
        [directories addObject:directoryPath];
      }
    }

    for (NSString *directoryPath in directories) {
      [NSFileManager.defaultManager removeItemAtPath:directoryPath error:nil];
    }
    dispatch_async(dispatch_get_main_queue(), ^{ resolve(nil); });
  });
}

- (void)documentCameraViewControllerDidCancel:(VNDocumentCameraViewController *)controller
{
  if (controller != _scannerViewController) return;
  [self resolveCancelledFromController:controller];
}

- (void)documentCameraViewController:(VNDocumentCameraViewController *)controller
                    didFailWithError:(NSError *)error
{
  if (controller != _scannerViewController) return;
  [self rejectFromController:controller
                        code:@"document_scan_failed"
                     message:@"문서를 스캔하지 못했습니다. 카메라를 확인하고 다시 시도해 주세요."
                       error:error];
}

- (void)documentCameraViewController:(VNDocumentCameraViewController *)controller
                   didFinishWithScan:(VNDocumentCameraScan *)scan
{
  if (controller != _scannerViewController) return;

  RCTPromiseResolveBlock resolve = _scanResolve;
  RCTPromiseRejectBlock reject = _scanReject;
  NSUInteger maxPages = _maxPages;
  CGFloat jpegQuality = _jpegQuality;
  [self clearActiveScanner];

  [controller dismissViewControllerAnimated:YES completion:^{
    dispatch_async(self->_imageQueue, ^{
      @autoreleasepool {
        NSError *directoryError = nil;
        NSURL *scanDirectory = [self newScanDirectoryWithError:&directoryError];
        if (!scanDirectory) {
          dispatch_async(dispatch_get_main_queue(), ^{
            reject(@"document_scan_storage",
                   @"스캔 이미지를 저장할 공간을 준비하지 못했습니다.",
                   directoryError);
          });
          return;
        }

        NSUInteger pageCount = MIN(scan.pageCount, maxPages);
        NSMutableArray<NSDictionary *> *pages = [NSMutableArray arrayWithCapacity:pageCount];
        NSError *writeError = nil;
        for (NSUInteger index = 0; index < pageCount; index += 1) {
          @autoreleasepool {
            UIImage *image = [scan imageOfPageAtIndex:index];
            NSData *jpegData = UIImageJPEGRepresentation(image, jpegQuality);
            if (!jpegData) {
              writeError = [NSError errorWithDomain:@"com.nolate.document-scanner"
                                                code:1001
                                            userInfo:@{ NSLocalizedDescriptionKey: @"스캔 이미지를 JPEG로 변환하지 못했습니다." }];
              break;
            }

            NSURL *pageURL = [scanDirectory URLByAppendingPathComponent:
                [NSString stringWithFormat:@"page-%02lu.jpg", (unsigned long)(index + 1)]];
            if (![jpegData writeToURL:pageURL options:NSDataWritingAtomic error:&writeError]) break;

            CGFloat pixelWidth = image.size.width * image.scale;
            CGFloat pixelHeight = image.size.height * image.scale;
            [pages addObject:@{
              @"uri": pageURL.absoluteString,
              @"width": @((NSInteger)MAX(1, lround(pixelWidth))),
              @"height": @((NSInteger)MAX(1, lround(pixelHeight))),
            }];
          }
        }

        if (writeError || pages.count == 0) {
          [NSFileManager.defaultManager removeItemAtURL:scanDirectory error:nil];
          dispatch_async(dispatch_get_main_queue(), ^{
            reject(@"document_scan_storage",
                   @"스캔 이미지를 저장하지 못했습니다. 저장 공간을 확인해 주세요.",
                   writeError);
          });
          return;
        }

        dispatch_async(dispatch_get_main_queue(), ^{
          resolve(@{
            @"cancelled": @NO,
            @"pages": pages,
            @"capturedPageCount": @(scan.pageCount),
          });
        });
      }
    });
  }];
}

@end

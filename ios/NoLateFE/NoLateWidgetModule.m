#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NoLateWidget, NSObject)

RCT_EXTERN_METHOD(writeSnapshot:(id)snapshot
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearSnapshot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end

#import <React/RCTComponent.h>
#import <React/RCTViewManager.h>

#import "NoLateFE-Swift.h"

@interface ViewModeLiquidDropdownManager : RCTViewManager
@end

@implementation ViewModeLiquidDropdownManager

RCT_EXPORT_MODULE(ViewModeLiquidDropdown)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [ViewModeLiquidDropdownView new];
}

RCT_EXPORT_VIEW_PROPERTY(visible, BOOL)
RCT_EXPORT_VIEW_PROPERTY(selectedMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(onSelect, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onClose, RCTBubblingEventBlock)

@end

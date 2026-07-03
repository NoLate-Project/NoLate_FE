#import <React/RCTComponent.h>
#import <React/RCTViewManager.h>

#import "NoLateFE-Swift.h"

@interface ViewModeGlassControlManager : RCTViewManager
@end

@interface LiquidGlassIconButtonManager : RCTViewManager
@end

@interface LiquidGlassSegmentedPillManager : RCTViewManager
@end

@implementation LiquidGlassIconButtonManager

RCT_EXPORT_MODULE(LiquidGlassIconButton)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [LiquidGlassIconButtonView new];
}

RCT_EXPORT_VIEW_PROPERTY(symbolName, NSString)
RCT_EXPORT_VIEW_PROPERTY(label, NSString)
RCT_EXPORT_VIEW_PROPERTY(leadingSymbolName, NSString)
RCT_EXPORT_VIEW_PROPERTY(trailingSymbolName, NSString)
RCT_EXPORT_VIEW_PROPERTY(buttonWidth, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(buttonHeight, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(disabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(colorScheme, NSString)
RCT_EXPORT_VIEW_PROPERTY(onPress, RCTBubblingEventBlock)

@end

@implementation LiquidGlassSegmentedPillManager

RCT_EXPORT_MODULE(LiquidGlassSegmentedPill)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [LiquidGlassSegmentedPillView new];
}

RCT_EXPORT_VIEW_PROPERTY(symbolNames, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectedIndex, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(buttonHeight, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(slotWidth, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(disabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(colorScheme, NSString)
RCT_EXPORT_VIEW_PROPERTY(onSelect, RCTBubblingEventBlock)

@end

@implementation ViewModeGlassControlManager

RCT_EXPORT_MODULE(ViewModeGlassControl)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [ViewModeGlassControlView new];
}

RCT_EXPORT_VIEW_PROPERTY(selectedMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(disabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(colorScheme, NSString)
RCT_EXPORT_VIEW_PROPERTY(onSelect, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onOpenChange, RCTBubblingEventBlock)

@end

@interface LiquidCalendarMenuPrototypeManager : RCTViewManager
@end

@implementation LiquidCalendarMenuPrototypeManager

RCT_EXPORT_MODULE(LiquidCalendarMenuPrototype)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [LiquidCalendarMenuPrototypeView new];
}

RCT_EXPORT_VIEW_PROPERTY(selectedMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(viewModeVariant, NSString)
RCT_EXPORT_VIEW_PROPERTY(disabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(colorScheme, NSString)
RCT_EXPORT_VIEW_PROPERTY(tapRequest, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(closeRequest, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(addMenuRequest, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(quickAddRequest, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(manualAddRequest, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(searchExpandedWidth, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(searchQuery, NSString)
RCT_EXPORT_VIEW_PROPERTY(onSelect, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onOpenChange, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSearch, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSearchTextChange, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSearchClose, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onAdd, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onQuickAdd, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onManualAdd, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onManageCategories, RCTBubblingEventBlock)

@end

#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

@interface NoLateShareAuth : NSObject <RCTBridgeModule>
@end

static NSString * const NoLateSharedKeychainAccessGroup = @"457QQLB6H6.com.anonymous.nolatefe";
static NSString * const NoLateSharedAppGroup = @"group.com.anonymous.nolatefe.shared";
static NSString * const NoLateAppGroupSessionStateKey = @"nolate_auth_session_state";

@implementation NoLateShareAuth

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSMutableDictionary *)queryForKey:(NSString *)key
{
  NSData *encodedKey = [key dataUsingEncoding:NSUTF8StringEncoding];
  return [@{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: @"app:no-auth",
    (__bridge id)kSecAttrAccount: encodedKey,
    (__bridge id)kSecAttrGeneric: encodedKey,
    (__bridge id)kSecAttrAccessGroup: NoLateSharedKeychainAccessGroup,
  } mutableCopy];
}

- (NSError *)keychainErrorWithStatus:(OSStatus)status operation:(NSString *)operation
{
  NSString *message = [NSString stringWithFormat:@"공유 Keychain %@ 실패 (OSStatus: %d)", operation, (int)status];
#if DEBUG
  NSLog(@"[NoLateShareAuth] %@", message);
#endif
  return [NSError errorWithDomain:NSOSStatusErrorDomain
                             code:status
                         userInfo:@{NSLocalizedDescriptionKey: message}];
}

- (NSDictionary *)writeAppGroupSessionStateSynchronously:(NSString *)value
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:NoLateSharedAppGroup];
  if (defaults == nil) {
    return @{@"success": @NO, @"error": @"app_group_unavailable"};
  }
  [defaults setObject:value forKey:NoLateAppGroupSessionStateKey];
  if (![defaults synchronize]) {
    return @{@"success": @NO, @"error": @"app_group_write_failed"};
  }
  return @{@"success": @YES};
}

RCT_REMAP_METHOD(getItem,
                 getItemForKey:(NSString *)key
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSMutableDictionary *query = [self queryForKey:key];
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  query[(__bridge id)kSecReturnData] = @YES;
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecItemNotFound) {
    resolve(nil);
    return;
  }
  if (status != errSecSuccess) {
    NSError *error = [self keychainErrorWithStatus:status operation:@"조회"];
    reject(@"shared_keychain_read_failed", error.localizedDescription, error);
    return;
  }
  NSData *data = CFBridgingRelease(result);
  resolve([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
}

RCT_REMAP_METHOD(setItem,
                 setItemForKey:(NSString *)key
                 value:(NSString *)value
                 setResolver:(RCTPromiseResolveBlock)resolve
                 setRejecter:(RCTPromiseRejectBlock)reject)
{
  NSMutableDictionary *query = [self queryForKey:key];
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *updatedValue = @{(__bridge id)kSecValueData: data};
  OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query,
                                  (__bridge CFDictionaryRef)updatedValue);
  if (status == errSecItemNotFound) {
    NSMutableDictionary *addQuery = [query mutableCopy];
    addQuery[(__bridge id)kSecValueData] = data;
    addQuery[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlocked;
    status = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
    if (status == errSecDuplicateItem) {
      // Expo SecureStore and this bridge address the same signed-iOS
      // Keychain row. If both observe a missing row, the other writer may win
      // between our Update and Add. Retry Update so that race is an idempotent
      // upsert instead of an intermittent session-commit failure.
      status = SecItemUpdate((__bridge CFDictionaryRef)query,
                             (__bridge CFDictionaryRef)updatedValue);
    }
  }
  if (status != errSecSuccess) {
    NSError *error = [self keychainErrorWithStatus:status operation:@"저장"];
    reject(@"shared_keychain_write_failed", error.localizedDescription, error);
    return;
  }
  resolve(@YES);
}

RCT_REMAP_METHOD(deleteItem,
                 deleteItemForKey:(NSString *)key
                 deleteResolver:(RCTPromiseResolveBlock)resolve
                 deleteRejecter:(RCTPromiseRejectBlock)reject)
{
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)[self queryForKey:key]);
  if (status != errSecSuccess && status != errSecItemNotFound) {
    NSError *error = [self keychainErrorWithStatus:status operation:@"삭제"];
    reject(@"shared_keychain_delete_failed", error.localizedDescription, error);
    return;
  }
  resolve(@YES);
}

RCT_REMAP_METHOD(getAppGroupSessionState,
                 getAppGroupSessionStateWithResolver:(RCTPromiseResolveBlock)resolve
                 appGroupReadRejecter:(RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:NoLateSharedAppGroup];
  if (defaults == nil) {
    reject(@"app_group_unavailable", @"공유 App Group 저장소를 열 수 없습니다.", nil);
    return;
  }
  id value = [defaults objectForKey:NoLateAppGroupSessionStateKey];
  if (value != nil && ![value isKindOfClass:[NSString class]]) {
    reject(@"app_group_invalid_value", @"공유 App Group 인증 상태가 올바르지 않습니다.", nil);
    return;
  }
  resolve(value);
}

RCT_REMAP_METHOD(setAppGroupSessionState,
                 setAppGroupSessionStateValue:(NSString *)value
                 appGroupWriteResolver:(RCTPromiseResolveBlock)resolve
                 appGroupWriteRejecter:(RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:NoLateSharedAppGroup];
  if (defaults == nil) {
    reject(@"app_group_unavailable", @"공유 App Group 저장소를 열 수 없습니다.", nil);
    return;
  }
  [defaults setObject:value forKey:NoLateAppGroupSessionStateKey];
  if (![defaults synchronize]) {
    reject(@"app_group_write_failed", @"공유 App Group 인증 상태를 저장하지 못했습니다.", nil);
    return;
  }
  resolve(@YES);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(setAppGroupSessionStateSync:(NSString *)value)
{
  return [self writeAppGroupSessionStateSynchronously:value];
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(beginAppGroupSessionTransitionSync:
                                       (NSString *)stagingValue)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:NoLateSharedAppGroup];
  if (defaults == nil) {
    return @{
      @"success": @NO,
      @"status": @"failure",
      @"error": @"app_group_unavailable",
    };
  }
  id currentValue = [defaults objectForKey:NoLateAppGroupSessionStateKey];
  if (currentValue != nil && ![currentValue isKindOfClass:[NSString class]]) {
    return @{
      @"success": @NO,
      @"status": @"failure",
      @"error": @"app_group_invalid_value",
    };
  }
  if ([(NSString *)currentValue isEqualToString:stagingValue]) {
    return @{@"success": @YES, @"status": @"success"};
  }
  if (
    [(NSString *)currentValue hasPrefix:@"staging:"] ||
    [(NSString *)currentValue hasPrefix:@"publishing:"]
  ) {
    return @{
      @"success": @NO,
      @"status": @"mismatch",
      @"mismatch": @YES,
      @"currentValue": currentValue,
    };
  }

  NSDictionary *result =
    [self writeAppGroupSessionStateSynchronously:stagingValue];
  if (![result[@"success"] boolValue]) {
    NSDictionary *rollback;
    if (currentValue == nil) {
      [defaults removeObjectForKey:NoLateAppGroupSessionStateKey];
      rollback = @{@"success": @([defaults synchronize])};
    } else {
      rollback =
        [self writeAppGroupSessionStateSynchronously:(NSString *)currentValue];
    }
    return @{
      @"success": @NO,
      @"status": @"partial",
      @"error": result[@"error"] ?: @"app_group_write_failed",
      @"rollbackSucceeded": @([rollback[@"success"] boolValue]),
    };
  }
  return @{@"success": @YES, @"status": @"success"};
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(compareAndSetAppGroupSessionStateSync:
                                       (NSString *)expectedValue
                                       value:(NSString *)value)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:NoLateSharedAppGroup];
  if (defaults == nil) {
    return @{
      @"success": @NO,
      @"status": @"failure",
      @"error": @"app_group_unavailable",
    };
  }
  id currentValue = [defaults objectForKey:NoLateAppGroupSessionStateKey];
  if (currentValue != nil && ![currentValue isKindOfClass:[NSString class]]) {
    return @{
      @"success": @NO,
      @"status": @"failure",
      @"error": @"app_group_invalid_value",
    };
  }
  if (![(NSString *)currentValue isEqualToString:expectedValue]) {
    // A mismatch can mean another process already published a newer session.
    // Report it without writing anything so JS can fail only this attempt and
    // must not invalidate active:B.
    return @{
      @"success": @NO,
      @"status": @"mismatch",
      @"mismatch": @YES,
      @"currentValue": currentValue ?: [NSNull null],
    };
  }
  NSDictionary *result = [self writeAppGroupSessionStateSynchronously:value];
  if (![result[@"success"] boolValue]) {
    // setObject can update the process-local defaults cache even when
    // synchronize reports failure. Never leave a partial active publication
    // behind after a failed CAS.
    NSDictionary *rollback =
      [self writeAppGroupSessionStateSynchronously:@"invalidated"];
    return @{
      @"success": @NO,
      @"status": @"partial",
      @"error": result[@"error"] ?: @"app_group_write_failed",
      @"rollbackSucceeded": @([rollback[@"success"] boolValue]),
    };
  }
  return @{@"success": @YES, @"status": @"success"};
}

@end

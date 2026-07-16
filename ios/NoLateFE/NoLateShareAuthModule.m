#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

@interface NoLateShareAuth : NSObject <RCTBridgeModule>
@end
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
  } mutableCopy];
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
    reject(@"shared_keychain_read_failed", @"공유 인증 정보를 읽지 못했습니다.", nil);
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
  OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query,
                                  (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData: data});
  if (status == errSecItemNotFound) {
    query[(__bridge id)kSecValueData] = data;
    query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlocked;
    status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
  }
  if (status != errSecSuccess) {
    reject(@"shared_keychain_write_failed", @"공유 인증 정보를 저장하지 못했습니다.", nil);
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
    reject(@"shared_keychain_delete_failed", @"공유 인증 정보를 삭제하지 못했습니다.", nil);
    return;
  }
  resolve(@YES);
}

@end

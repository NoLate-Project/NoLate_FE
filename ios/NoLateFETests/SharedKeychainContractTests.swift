import Security
import XCTest

final class SharedKeychainContractTests: XCTestCase {
  private let accessGroup = "457QQLB6H6.com.anonymous.nolatefe"
  private let service = "app:no-auth"

  func testSharedKeychainAccessGroupCanRoundTripTokenData() throws {
    let account = "nolate_native_test_\(UUID().uuidString)"
    let accountData = Data(account.utf8)
    let expected = Data("test-token".utf8)
    let baseQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: accountData,
      kSecAttrGeneric as String: accountData,
      kSecAttrAccessGroup as String: accessGroup,
    ]

    SecItemDelete(baseQuery as CFDictionary)
    defer { SecItemDelete(baseQuery as CFDictionary) }

    var insert = baseQuery
    insert[kSecValueData as String] = expected
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
    XCTAssertEqual(
      SecItemAdd(insert as CFDictionary, nil),
      errSecSuccess,
      "The host app must be signed with the shared Keychain access-group entitlement."
    )

    var lookup = baseQuery
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    lookup[kSecReturnData as String] = true
    var result: CFTypeRef?
    XCTAssertEqual(SecItemCopyMatching(lookup as CFDictionary, &result), errSecSuccess)
    XCTAssertEqual(result as? Data, expected)
  }

  func testGlobalArbitraryNetworkLoadsAreDisabled() {
    let transport = Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any]
    XCTAssertFalse(transport?["NSAllowsArbitraryLoads"] as? Bool ?? false)
    XCTAssertFalse(transport?["NSAllowsArbitraryLoadsInWebContent"] as? Bool ?? false)
  }
}

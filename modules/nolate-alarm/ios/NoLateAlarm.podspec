Pod::Spec.new do |s|
  s.name = 'NoLateAlarm'
  s.version = '1.0.0'
  s.summary = 'NoLate native departure alarms for Apple platforms.'
  s.description = 'An Expo module backed by AlarmKit on iOS 26 and time-sensitive notifications on earlier iOS versions.'
  s.license = { :type => 'Proprietary' }
  s.author = { 'NoLate' => 'dev@nolate.app' }
  s.homepage = 'https://github.com/'
  s.source = { :git => 'https://github.com/', :tag => s.version.to_s }
  s.platform = :ios, '16.6'
  s.swift_version = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'
  s.frameworks = 'CryptoKit', 'Foundation', 'UIKit', 'UserNotifications', 'SwiftUI'
  s.weak_frameworks = 'AlarmKit'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end

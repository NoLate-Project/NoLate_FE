Pod::Spec.new do |s|
  s.name = 'NoLateTMap'
  s.version = '1.0.0'
  s.summary = 'NoLate Expo bridge for the TMAP iOS Vector Map SDK.'
  s.description = 'A local Expo Modules API view backed by TMAP Vector Map SDK 3.7.'
  s.license = { :type => 'Proprietary' }
  s.author = { 'NoLate' => 'dev@nolate.app' }
  s.homepage = 'https://github.com/'
  s.source = { :git => 'https://github.com/', :tag => s.version.to_s }
  s.platform = :ios, '16.6'
  s.swift_version = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.{h,m,mm,swift}'
  s.vendored_frameworks = 'Vendor/TMapSDK.xcframework', 'Vendor/VSMSDK.xcframework'
  s.frameworks = 'CoreLocation', 'CoreGraphics', 'Foundation', 'QuartzCore', 'Security', 'UIKit'
  s.libraries = 'c++', 'z'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end

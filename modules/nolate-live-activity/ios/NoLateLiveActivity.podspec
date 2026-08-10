Pod::Spec.new do |s|
  s.name = 'NoLateLiveActivity'
  s.version = '1.0.0'
  s.summary = 'NoLate ActivityKit bridge and departure ETA state.'
  s.description = 'Expo module that starts, updates, restores, and ends NoLate Live Activities.'
  s.license = { :type => 'Proprietary' }
  s.author = { 'NoLate' => 'dev@nolate.app' }
  s.homepage = 'https://github.com/'
  s.source = { :git => 'https://github.com/', :tag => s.version.to_s }
  s.platform = :ios, '16.6'
  s.swift_version = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift', 'Shared/NoLateDepartureActivityAttributes.swift'
  s.frameworks = 'ActivityKit', 'Foundation'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end

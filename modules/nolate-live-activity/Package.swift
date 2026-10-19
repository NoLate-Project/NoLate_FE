// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "NoLateLiveActivityPolicy",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "NoLateLiveActivityPolicy", targets: ["NoLateLiveActivityPolicy"])
  ],
  targets: [
    .target(
      name: "NoLateLiveActivityPolicy",
      path: "ios",
      exclude: [
        "Extension",
        "NoLateLiveActivity.podspec",
        "NoLateLiveActivityCoordinator.swift",
        "NoLateLiveActivityModule.swift",
        "NoLateJourneyRuntime.swift",
        "NoLateJourneyAutomaticRuntime.swift",
        "NoLateAutomaticGuidanceActivity.swift",
        "NoLateGuidancePushPilot.swift",
        "NoLateSavedGuidanceArrivalTransport.swift",
        "NoLateSavedGuidanceRideTransport.swift",
        "NoLateSavedGuidanceSubwayTransport.swift",
        "Shared",
        "Tests"
      ],
      sources: ["NoLateServerWalkingSnapshot.swift", "NoLateLiveActivityModels.swift", "NoLateJourneyDiagnostics.swift", "NoLateJourneyEngineCore.swift", "NoLateJourneyCheckpointStore.swift", "NoLateJourneyRouteNormalizer.swift", "NoLateJourneyAutomaticSession.swift", "NoLateJourneyAutomaticStore.swift", "NoLateJourneyBusApproachCore.swift", "NoLateJourneyBusRideCore.swift", "NoLateJourneySubwayRideCore.swift", "NoLateSavedGuidanceSubwayPolicy.swift", "NoLateGuidanceContent.swift", "NoLateGuidancePublicationPolicy.swift", "NoLateAutomaticGuidanceProjection.swift", "NoLateSavedGuidanceArrivalPolicy.swift", "NoLateSavedGuidanceRidePolicy.swift"]
    ),
    .testTarget(
      name: "NoLateLiveActivityPolicyTests",
      dependencies: ["NoLateLiveActivityPolicy"],
      path: "ios/Tests"
    )
  ]
)

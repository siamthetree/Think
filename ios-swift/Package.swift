// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ChintaApp",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "ChintaApp",
            targets: ["ChintaApp"]
        )
    ],
    dependencies: [],
    targets: [
        .target(
            name: "ChintaApp",
            dependencies: [],
            path: "Sources/ChintaApp"
        )
    ]
)

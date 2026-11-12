// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ChintaApp",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "ChintaApp",
            targets: ["ChintaApp"]
        )
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "ChintaApp",
            dependencies: [],
            path: "Sources/ChintaApp",
            exclude: ["Resources/Info.plist"]
        )
    ]
)

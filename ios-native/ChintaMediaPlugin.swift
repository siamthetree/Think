import Foundation
import UIKit
import Photos
import Capacitor

@objc(ChintaMediaPlugin)
public class ChintaMediaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ChintaMediaPlugin"
    public let jsName = "ChintaMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareToInstagramStory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareToFacebookStory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveImageToGallery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareImageSheet", returnType: CAPPluginReturnPromise)
    ]

    private func decodeImageData(from base64: String?) -> Data? {
        guard let raw = base64, !raw.isEmpty else { return nil }
        let cleaned: String
        if let commaRange = raw.range(of: "base64,") {
            cleaned = String(raw[commaRange.upperBound...])
        } else {
            cleaned = raw
        }
        return Data(base64Encoded: cleaned, options: .ignoreUnknownCharacters)
    }

    private func presentActivitySheet(image: UIImage, title: String?, call: CAPPluginCall, message: String) {
        DispatchQueue.main.async {
            var items: [Any] = [image]
            if let title = title, !title.isEmpty {
                items.append(title)
            }
            let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
            if let rootVC = self.bridge?.viewController {
                if let popover = vc.popoverPresentationController {
                    popover.sourceView = rootVC.view
                    popover.sourceRect = CGRect(
                        x: rootVC.view.bounds.midX,
                        y: rootVC.view.bounds.midY,
                        width: 0,
                        height: 0
                    )
                    popover.permittedArrowDirections = []
                }
                rootVC.present(vc, animated: true) {
                    call.resolve([
                        "ok": true,
                        "method": "ios-activity-sheet",
                        "message": message
                    ])
                }
            } else {
                call.reject("Unable to present share sheet.")
            }
        }
    }

    @objc public func shareToInstagramStory(_ call: CAPPluginCall) {
        let stickerData = decodeImageData(from: call.getString("stickerBase64"))
        let fullData = decodeImageData(from: call.getString("imageBase64"))
        guard let fallbackData = fullData ?? stickerData,
              let fallbackImage = UIImage(data: fallbackData) else {
            call.reject("Missing or invalid story image data.")
            return
        }

        let allowMusic = call.getBool("allowMusic") ?? true
        let topColor = call.getString("topColor") ?? "#EA580C"
        let bottomColor = call.getString("bottomColor") ?? "#140C08"
        let sourceApp = Bundle.main.bundleIdentifier ?? "app.chinta.reader"

        // Mode A (Allow IG Music): Save the composed 9:16 card (with user's exact layout)
        // directly to Photos and open Instagram's story camera so Instagram does NOT lock
        // the Music sticker with "You can't add a song because the story is shared from another app".
        if allowMusic {
            let openCameraAndResolve: () -> Void = {
                DispatchQueue.main.async {
                    if let stickerPng = stickerData, let stickerImg = UIImage(data: stickerPng) {
                        UIPasteboard.general.image = stickerImg
                    }
                    let cameraUrl = URL(string: "instagram://story-camera")
                    let appUrl = URL(string: "instagram://app")
                    if let url = cameraUrl, UIApplication.shared.canOpenURL(url) {
                        UIApplication.shared.open(url, options: [:]) { opened in
                            if opened {
                                call.resolve([
                                    "ok": true,
                                    "method": "ios-instagram-music-ready",
                                    "message": "Saved to Photos — pick it in Instagram Stories to add any song."
                                ])
                            } else {
                                self.presentActivitySheet(
                                    image: fallbackImage,
                                    title: nil,
                                    call: call,
                                    message: "Saved to Photos — open Instagram Stories & add music."
                                )
                            }
                        }
                    } else if let url = appUrl, UIApplication.shared.canOpenURL(url) {
                        UIApplication.shared.open(url, options: [:]) { _ in
                            call.resolve([
                                "ok": true,
                                "method": "ios-instagram-music-ready",
                                "message": "Saved to Photos — create a Story in Instagram to add any song."
                            ])
                        }
                    } else {
                        self.presentActivitySheet(
                            image: fallbackImage,
                            title: nil,
                            call: call,
                            message: "Saved to Photos — share to Instagram to add music."
                        )
                    }
                }
            }

            let saveAndOpen: () -> Void = {
                PHPhotoLibrary.shared().performChanges({
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, data: fallbackData, options: nil)
                }) { success, _ in
                    if success {
                        openCameraAndResolve()
                    } else {
                        DispatchQueue.main.async {
                            self.presentActivitySheet(
                                image: fallbackImage,
                                title: nil,
                                call: call,
                                message: "Tap Save Image, then pick from Photos in Instagram to add music."
                            )
                        }
                    }
                }
            }

            if #available(iOS 14, *) {
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                    if status == .authorized || status == .limited {
                        saveAndOpen()
                    } else {
                        DispatchQueue.main.async {
                            self.presentActivitySheet(
                                image: fallbackImage,
                                title: nil,
                                call: call,
                                message: "Tap Save Image, then open Instagram Stories to add music."
                            )
                        }
                    }
                }
            } else {
                PHPhotoLibrary.requestAuthorization { status in
                    if status == .authorized {
                        saveAndOpen()
                    } else {
                        DispatchQueue.main.async {
                            self.presentActivitySheet(
                                image: fallbackImage,
                                title: nil,
                                call: call,
                                message: "Tap Save Image, then open Instagram Stories to add music."
                            )
                        }
                    }
                }
            }
            return
        }

        // Mode B (Floating Interactive Sticker): Direct instagram-stories://share pasteboard
        DispatchQueue.main.async {
            guard let schemeUrl = URL(string: "instagram-stories://share?source_application=\(sourceApp)"),
                  UIApplication.shared.canOpenURL(schemeUrl) else {
                self.presentActivitySheet(
                    image: fallbackImage,
                    title: nil,
                    call: call,
                    message: "Instagram not detected — choose an app or Save Image."
                )
                return
            }

            var pasteboardItem: [String: Any] = [
                "com.instagram.sharedSticker.backgroundTopColor": topColor,
                "com.instagram.sharedSticker.backgroundBottomColor": bottomColor
            ]
            if let stickerPng = stickerData {
                pasteboardItem["com.instagram.sharedSticker.stickerImage"] = stickerPng
            } else {
                pasteboardItem["com.instagram.sharedSticker.backgroundImage"] = fallbackData
            }

            let options: [UIPasteboard.OptionsKey: Any] = [
                .expirationDate: Date().addingTimeInterval(60 * 5)
            ]
            UIPasteboard.general.setItems([pasteboardItem], options: options)

            UIApplication.shared.open(schemeUrl, options: [:]) { opened in
                if opened {
                    call.resolve([
                        "ok": true,
                        "method": "ios-instagram-stories",
                        "message": "Opening Instagram Stories..."
                    ])
                } else {
                    self.presentActivitySheet(
                        image: fallbackImage,
                        title: nil,
                        call: call,
                        message: "Select Instagram or Save Image."
                    )
                }
            }
        }
    }

    @objc public func shareToFacebookStory(_ call: CAPPluginCall) {
        let stickerData = decodeImageData(from: call.getString("stickerBase64"))
        let fullData = decodeImageData(from: call.getString("imageBase64"))
        guard let fallbackData = fullData ?? stickerData,
              let fallbackImage = UIImage(data: fallbackData) else {
            call.reject("Missing or invalid story image data.")
            return
        }

        let topColor = call.getString("topColor") ?? "#EA580C"
        let bottomColor = call.getString("bottomColor") ?? "#140C08"
        let sourceApp = Bundle.main.bundleIdentifier ?? "app.chinta.reader"
        let appId = call.getString("appId") ?? sourceApp

        DispatchQueue.main.async {
            let primaryUrl = URL(string: "facebook-stories://share?source_application=\(sourceApp)")
            let altUrl = URL(string: "fb-stories://share?source_application=\(sourceApp)")

            let targetUrl: URL?
            if let u = primaryUrl, UIApplication.shared.canOpenURL(u) {
                targetUrl = u
            } else if let u = altUrl, UIApplication.shared.canOpenURL(u) {
                targetUrl = u
            } else {
                targetUrl = nil
            }

            guard let schemeUrl = targetUrl else {
                self.presentActivitySheet(
                    image: fallbackImage,
                    title: nil,
                    call: call,
                    message: "Facebook not detected — choose an app or Save Image."
                )
                return
            }

            var pasteboardItem: [String: Any] = [
                "com.facebook.sharedSticker.backgroundTopColor": topColor,
                "com.facebook.sharedSticker.backgroundBottomColor": bottomColor,
                "com.facebook.sharedSticker.appID": appId
            ]
            if let stickerPng = stickerData {
                // Interactive floating card sticker over independent background gradient
                pasteboardItem["com.facebook.sharedSticker.stickerImage"] = stickerPng
            } else {
                pasteboardItem["com.facebook.sharedSticker.backgroundImage"] = fallbackData
            }
            let options: [UIPasteboard.OptionsKey: Any] = [
                .expirationDate: Date().addingTimeInterval(60 * 5)
            ]
            UIPasteboard.general.setItems([pasteboardItem], options: options)

            UIApplication.shared.open(schemeUrl, options: [:]) { opened in
                if opened {
                    call.resolve([
                        "ok": true,
                        "method": "ios-facebook-stories",
                        "message": "Opening Facebook Stories..."
                    ])
                } else {
                    self.presentActivitySheet(
                        image: fallbackImage,
                        title: nil,
                        call: call,
                        message: "Select Facebook or Save Image."
                    )
                }
            }
        }
    }

    @objc public func shareImageSheet(_ call: CAPPluginCall) {
        guard let pngData = decodeImageData(from: call.getString("imageBase64")),
              let image = UIImage(data: pngData) else {
            call.reject("Missing or invalid image data.")
            return
        }
        presentActivitySheet(
            image: image,
            title: call.getString("title"),
            call: call,
            message: "Share sheet opened."
        )
    }

    @objc public func saveImageToGallery(_ call: CAPPluginCall) {
        if let imageData = decodeImageData(from: call.getString("imageBase64")) {
            savePhotoDataToLibrary(data: imageData, call: call)
            return
        }

        if let urlStr = call.getString("imageUrl"),
           let url = URL(string: urlStr),
           (url.scheme == "https" || url.scheme == "http") {
            URLSession.shared.dataTask(with: url) { data, _, error in
                if let error = error {
                    call.reject("Could not download photo: \(error.localizedDescription)")
                    return
                }
                guard let data = data, UIImage(data: data) != nil else {
                    call.reject("Downloaded file is not a valid image.")
                    return
                }
                self.savePhotoDataToLibrary(data: data, call: call)
            }.resume()
            return
        }

        call.reject("Provide imageBase64 or imageUrl to save to Photos.")
    }

    private func savePhotoDataToLibrary(data: Data, call: CAPPluginCall) {
        let performSave: () -> Void = {
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: .photo, data: data, options: nil)
            }) { success, error in
                if success {
                    call.resolve([
                        "ok": true,
                        "method": "ios-photos",
                        "message": "Saved to Photos gallery."
                    ])
                } else {
                    call.reject(error?.localizedDescription ?? "Failed to save to Photos gallery.")
                }
            }
        }

        if #available(iOS 14, *) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                if status == .authorized || status == .limited {
                    performSave()
                } else {
                    call.reject("Photos access denied. Enable Photos Add access in iPhone Settings.")
                }
            }
        } else {
            PHPhotoLibrary.requestAuthorization { status in
                if status == .authorized {
                    performSave()
                } else {
                    call.reject("Photos access denied. Enable Photos access in iPhone Settings.")
                }
            }
        }
    }
}

public class ChintaViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(ChintaMediaPlugin())
    }
}

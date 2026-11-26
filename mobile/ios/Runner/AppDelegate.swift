import CoreLocation
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // ML veri toplama kanali (Android: MainActivity.kt + RssiLogger.kt)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "RssiLogger") {
      RssiLogger.shared.register(messenger: registrar.messenger())
    }
  }
}

// MARK: - ML veri toplama modu (iOS)
//
// Bu sinif ayri bir dosyada degil, cunku yeni .swift dosyasi Xcode proje dosyasina
// (project.pbxproj) eklenmeden derlenmez; Mac'te Xcode ile ayri dosyaya tasinabilir.
//
// - Kanal "attendance/rssi_logger": start, stop, status, files, delete, share (Android ile ayni).
// - iOS iBeacon'lari normal Bluetooth taramasindan gizler; RSSI sadece CoreLocation ile, UUID
//   onceden verilerek alinir (ranging). iPhone saniyede bir, o saniyenin ortalamasini verir;
//   duyamadiginda rssi = 0 verir: bu satirlar YAZILMAZ.
// - Cepte olcum: kayit surerken arka plan konum oturumu acik tutulur (Info.plist
//   UIBackgroundModes = location), ekranin ustunde mavi konum gostergesi gorunur.
// - CSV sutunlari Android ile ayni: time,platform,phone_model,room,rssi,label,location,carry
// - Dosyalar: Belgeler/rssi/*.csv; "Paylas" ile ya da Dosyalar uygulamasindan alinir.
final class RssiLogger: NSObject, CLLocationManagerDelegate {
  static let shared = RssiLogger()

  private static let header = "time,platform,phone_model,room,rssi,label,location,carry"
  private let constraint = CLBeaconIdentityConstraint(
    uuid: UUID(uuidString: "6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47")!)
  private let manager = CLLocationManager()
  private var channel: FlutterMethodChannel?

  private var handle: FileHandle?
  private var fileName: String?
  private var label = 0
  private var location = ""
  private var carry = ""
  private var rows = 0
  private var startedAt: Int64 = 0
  private var lastAt: Int64 = 0
  private var lastRssi: Int?
  // Konum izni beklenirken "start" istegi burada bekler
  private var pendingStart: (() -> Void)?

  private let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()

  // "iPhone14,5" gibi donanim kodu; virgul CSV'yi bozmasin diye "_"
  private let phoneModel: String = {
    var info = utsname()
    uname(&info)
    let machine = withUnsafeBytes(of: &info.machine) { raw in
      String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
    }
    return machine.replacingOccurrences(of: "[^A-Za-z0-9_.-]", with: "_", options: .regularExpression)
  }()

  func register(messenger: FlutterBinaryMessenger) {
    manager.delegate = self
    let ch = FlutterMethodChannel(name: "attendance/rssi_logger", binaryMessenger: messenger)
    ch.setMethodCallHandler { [weak self] call, result in
      self?.handle(call, result)
    }
    channel = ch
  }

  // MARK: Kanal

  private func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any] ?? [:]
    switch call.method {
    case "start":
      guard let label = args["label"] as? Int, label == 0 || label == 1,
            let location = args["location"] as? String, isSafe(location),
            let carry = args["carry"] as? String, isSafe(carry) else {
        result(FlutterError(code: "rssi_logger", message: "Geçersiz etiket/konum/taşıma", details: nil))
        return
      }
      withPermission { [weak self] granted in
        guard let self = self else { return }
        guard granted else {
          result(FlutterError(code: "permission",
                              message: "Konum izni gerekli: Ayarlar > Yoklama Sistemi > Konum",
                              details: nil))
          return
        }
        do {
          result(try self.startRecording(label: label, location: location, carry: carry))
        } catch {
          result(FlutterError(code: "rssi_logger", message: error.localizedDescription, details: nil))
        }
      }
    case "stop":
      let s = status()
      stopRecording()
      result(s)
    case "status":
      result(status())
    case "files":
      result(files())
    case "delete":
      guard let name = args["name"] as? String, let url = fileURL(name), name != fileName || handle == nil else {
        result(false)
        return
      }
      result((try? FileManager.default.removeItem(at: url)) != nil)
    case "share":
      let urls = (args["names"] as? [String] ?? []).compactMap { fileURL($0) }
      guard !urls.isEmpty else {
        result(FlutterError(code: "rssi_logger", message: "Paylaşılacak dosya yok", details: nil))
        return
      }
      share(urls)
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func isSafe(_ text: String) -> Bool {
    text.range(of: "^[a-z0-9_]{1,40}$", options: .regularExpression) != nil
  }

  // MARK: Izin

  private func withPermission(_ done: @escaping (Bool) -> Void) {
    switch manager.authorizationStatus {
    case .authorizedAlways, .authorizedWhenInUse:
      done(true)
    case .notDetermined:
      pendingStart = { [weak self] in
        guard let self = self else { return }
        let s = self.manager.authorizationStatus
        done(s == .authorizedAlways || s == .authorizedWhenInUse)
      }
      manager.requestWhenInUseAuthorization()
    default:
      done(false)
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard manager.authorizationStatus != .notDetermined, let pending = pendingStart else { return }
    pendingStart = nil
    pending()
  }

  // MARK: Kayit

  private func directory() throws -> URL {
    let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                           appropriateFor: nil, create: true)
    let dir = docs.appendingPathComponent("rssi", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func fileURL(_ name: String) -> URL? {
    guard name.hasSuffix(".csv"), !name.contains("/"), let dir = try? directory() else { return nil }
    return dir.appendingPathComponent(name)
  }

  private func startRecording(label: Int, location: String, carry: String) throws -> String {
    stopRecording()
    let stamp: String = {
      let f = DateFormatter()
      f.locale = Locale(identifier: "en_US_POSIX")
      f.dateFormat = "yyyyMMdd_HHmmss"
      return f.string(from: Date())
    }()
    let name = "\(stamp)_\(phoneModel)_\(location)_\(carry).csv"
    let url = try directory().appendingPathComponent(name)
    FileManager.default.createFile(atPath: url.path, contents: Data((RssiLogger.header + "\n").utf8))
    let h = try FileHandle(forWritingTo: url)
    h.seekToEndOfFile()

    handle = h
    fileName = name
    self.label = label
    self.location = location
    self.carry = carry
    rows = 0
    startedAt = Self.nowMs()
    lastAt = 0
    lastRssi = nil

    // Cepte / ekran kapaliyken de surmesi icin arka plan konum oturumu
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.showsBackgroundLocationIndicator = true
    manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
    manager.startUpdatingLocation()
    manager.startRangingBeacons(satisfying: constraint)
    return name
  }

  private func stopRecording() {
    guard let h = handle else { return }
    manager.stopRangingBeacons(satisfying: constraint)
    manager.stopUpdatingLocation()
    manager.allowsBackgroundLocationUpdates = false
    try? h.synchronize()
    try? h.close()
    handle = nil
  }

  func locationManager(_ manager: CLLocationManager, didRange beacons: [CLBeacon],
                       satisfying beaconConstraint: CLBeaconIdentityConstraint) {
    guard let h = handle else { return }
    let now = Date()
    let time = iso.string(from: now)
    var text = ""
    for b in beacons where b.rssi != 0 {   // 0 = o saniye duyulmadi
      text += "\(time),ios,\(phoneModel),\(b.major.intValue),\(b.rssi),\(label),\(location),\(carry)\n"
      rows += 1
      lastRssi = b.rssi
    }
    guard !text.isEmpty else { return }
    h.write(Data(text.utf8))
    lastAt = Self.nowMs()
  }

  func locationManager(_ manager: CLLocationManager, didFailRangingFor beaconConstraint: CLBeaconIdentityConstraint,
                       error: Error) {
    NSLog("RssiLogger ranging hatasi: \(error.localizedDescription)")
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {}

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("RssiLogger konum hatasi: \(error.localizedDescription)")
  }

  private func status() -> [String: Any?] {
    [
      "recording": handle != nil,
      "file": fileName,
      "rows": rows,
      "label": label,
      "location": location,
      "carry": carry,
      "startedAt": startedAt,
      "lastRssi": lastRssi,
      "lastAt": lastAt,
      "platform": "ios",
      "phoneModel": phoneModel,
    ]
  }

  private func files() -> [[String: Any]] {
    guard let dir = try? directory(),
          let urls = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else {
      return []
    }
    return urls.filter { $0.pathExtension == "csv" }.compactMap { url -> [String: Any]? in
      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
      let modified = values?.contentModificationDate ?? Date.distantPast
      return [
        "name": url.lastPathComponent,
        "size": values?.fileSize ?? 0,
        "modified": Int64(modified.timeIntervalSince1970 * 1000),
      ]
    }.sorted { ($0["modified"] as? Int64 ?? 0) > ($1["modified"] as? Int64 ?? 0) }
  }

  // MARK: Paylas

  private func share(_ urls: [URL]) {
    guard let root = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow })?.rootViewController else { return }
    var top = root
    while let presented = top.presentedViewController { top = presented }
    let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
    // iPad'de paylasim penceresi bir noktaya baglanmali
    sheet.popoverPresentationController?.sourceView = top.view
    sheet.popoverPresentationController?.sourceRect = CGRect(
      x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
    top.present(sheet, animated: true)
  }

  private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

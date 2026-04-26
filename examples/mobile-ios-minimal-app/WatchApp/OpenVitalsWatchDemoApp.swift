import Foundation
import SwiftUI

@main
struct OpenVitalsWatchDemoApp: App {
    var body: some Scene {
        WindowGroup {
            WatchWorkoutView()
        }
    }
}

struct WatchWorkoutView: View {
    @StateObject private var model = WatchWorkoutModel()

    var body: some View {
        NavigationStack {
            List {
                configurationSection
                liveWorkoutSection
                statusSection
                troubleshootingSection
            }
            .navigationTitle("OpenVitals")
            .onAppear {
                model.refreshConfigurationState()
            }
        }
    }

    private var configurationSection: some View {
        Section("Optional live HR setup") {
            TextField("API", text: $model.baseURLString)
            TextField("User", text: $model.userId)
            SecureField("Token", text: $model.token)
            TextField("Session", text: $model.sessionToken)

            Label(model.configurationState, systemImage: model.isConfigured ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(model.isConfigured ? .green : .orange)

            Text("The Watch app is optional and uploads only active workout heart-rate samples. Historical Watch data still syncs through the iPhone Health app.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var liveWorkoutSection: some View {
        Section("Live workout") {
            Button {
                model.start()
            } label: {
                Label("Start Live HR", systemImage: "play.fill")
            }
            .disabled(model.isStreaming || model.isStarting)

            Button(role: .destructive) {
                model.stop()
            } label: {
                Label("Stop", systemImage: "stop.fill")
            }
            .disabled(!model.isStreaming && !model.isStarting)

            Text("Starting creates an HKWorkoutSession and labels samples as `live_signal` / `live` with `device_pairing` connection mode.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var statusSection: some View {
        Section("Upload status") {
            LabeledContent("State", value: model.state)
            LabeledContent("Latest HR", value: model.latestHeartRate)
            LabeledContent("Uploaded", value: "\(model.uploadedCount)")
            LabeledContent("Pending", value: "\(model.pendingUploadCount)")
            LabeledContent("Failed", value: "\(model.failedUploadCount)")
            LabeledContent("Last sample", value: model.lastSampleText)
            LabeledContent("Last upload", value: model.lastUploadText)
        }
    }

    private var troubleshootingSection: some View {
        Section("Troubleshooting") {
            if let error = model.errorMessage {
                Label(error, systemImage: "xmark.octagon.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Text("If start fails, confirm HealthKit/workout permission on Apple Watch and make sure the API URL is reachable from the Watch network.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

@MainActor
final class WatchWorkoutModel: ObservableObject {
    @Published var baseURLString: String
    @Published var userId: String
    @Published var token: String
    @Published var sessionToken: String
    @Published var state = "idle"
    @Published var latestHeartRate = "-"
    @Published var uploadedCount = 0
    @Published var pendingUploadCount = 0
    @Published var failedUploadCount = 0
    @Published var lastSampleAt: Date?
    @Published var lastUploadAt: Date?
    @Published var errorMessage: String?
    @Published var isConfigured = false

    private let defaults = UserDefaults.standard
    private let secretStore = KeychainSecretStore(service: "ai.openvitals.watch-companion")
    private let anchorStore = UserDefaultsAnchorStore()
    private var streamer: AppleWatchLiveWorkoutHeartRateStreamer?

    init() {
        baseURLString = defaults.string(forKey: WatchDefaultsKey.baseURL) ?? "http://127.0.0.1:3000"
        userId = defaults.string(forKey: WatchDefaultsKey.userId) ?? "user_live"
        token = secretStore.string(for: WatchSecretKey.token) ?? defaults.string(forKey: WatchDefaultsKey.legacyToken) ?? ""
        sessionToken = secretStore.string(for: WatchSecretKey.sessionToken) ?? defaults.string(forKey: WatchDefaultsKey.legacySessionToken) ?? ""
        migrateLegacySecrets()
        refreshConfigurationState()
    }

    var isStarting: Bool {
        state == "starting"
    }

    var isStreaming: Bool {
        state == "streaming"
    }

    var configurationState: String {
        isConfigured ? "configured for optional live workout HR" : "configure API, user, and token first"
    }

    var lastSampleText: String {
        lastSampleAt.map(Self.displayDateFormatter.string(from:)) ?? "none"
    }

    var lastUploadText: String {
        lastUploadAt.map(Self.displayDateFormatter.string(from:)) ?? "none"
    }

    func refreshConfigurationState() {
        isConfigured = URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
            && !userId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func start() {
        persistSettings()
        refreshConfigurationState()
        guard isConfigured else {
            state = "not configured"
            errorMessage = "Enter API URL, user ID, and bearer token before starting live workout HR."
            return
        }
        state = "starting"
        errorMessage = nil
        Task { @MainActor in
            do {
                let collector = try makeCollector()
                try await collector.requestAuthorization()
                let activeSessionToken = try await ensureSessionToken(collector: collector)
                let activeUserId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
                let liveAnchorStore = anchorStore
                let nextStreamer = AppleWatchLiveWorkoutHeartRateStreamer(collector: collector)
                nextStreamer.onHeartRateRecord = { [weak self] record in
                    Task { @MainActor in
                        self?.handle(record: record, collector: collector, userId: activeUserId, sessionToken: activeSessionToken, anchorStore: liveAnchorStore)
                    }
                }
                nextStreamer.onError = { [weak self] error in
                    Task { @MainActor in
                        self?.state = "failed"
                        self?.errorMessage = Self.userFacingMessage(for: error)
                    }
                }
                try await nextStreamer.start(activityType: .other)
                streamer = nextStreamer
                state = "streaming"
            } catch {
                state = "failed"
                errorMessage = Self.userFacingMessage(for: error)
            }
        }
    }

    func stop() {
        state = "stopping"
        Task { @MainActor in
            do {
                try await streamer?.stop()
                streamer = nil
                state = "stopped"
            } catch {
                state = "failed"
                errorMessage = Self.userFacingMessage(for: error)
            }
        }
    }

    private func handle(record: IngestRecordPayload, collector: OpenVitalsCollector, userId: String, sessionToken: String, anchorStore: AnchorStore) {
        latestHeartRate = record.value.map { String(format: "%.0f bpm", $0) } ?? "-"
        lastSampleAt = Date()
        pendingUploadCount += 1
        Task { @MainActor in
            do {
                try await collector.uploadAnchoredBatch(
                    userId: userId,
                    sessionToken: sessionToken,
                    anchorStore: anchorStore,
                    anchorAfter: anchorStore.anchor(for: "apple-health", userId: userId),
                    records: [record]
                )
                pendingUploadCount = max(pendingUploadCount - 1, 0)
                uploadedCount += 1
                lastUploadAt = Date()
            } catch {
                pendingUploadCount = max(pendingUploadCount - 1, 0)
                failedUploadCount += 1
                errorMessage = Self.userFacingMessage(for: error)
            }
        }
    }

    private func makeCollector() throws -> OpenVitalsCollector {
        let trimmedURL = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let baseURL = URL(string: trimmedURL), let scheme = baseURL.scheme?.lowercased(), ["http", "https"].contains(scheme), baseURL.host != nil else {
            throw WatchValidationError.invalidBaseURL
        }
        let bearerToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !bearerToken.isEmpty else { throw WatchValidationError.missingBearerToken }
        guard !userId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WatchValidationError.missingUserId }
        return OpenVitalsCollector(baseURL: baseURL, token: bearerToken)
    }

    private func ensureSessionToken(collector: OpenVitalsCollector) async throws -> String {
        let trimmedSessionToken = sessionToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedSessionToken.isEmpty {
            return trimmedSessionToken
        }
        let response = try await collector.createAppleSession(userId: userId.trimmingCharacters(in: .whitespacesAndNewlines))
        sessionToken = response.sessionToken
        secretStore.setString(response.sessionToken, for: WatchSecretKey.sessionToken)
        return response.sessionToken
    }

    private func persistSettings() {
        defaults.set(baseURLString.trimmingCharacters(in: .whitespacesAndNewlines), forKey: WatchDefaultsKey.baseURL)
        defaults.set(userId.trimmingCharacters(in: .whitespacesAndNewlines), forKey: WatchDefaultsKey.userId)
        secretStore.setString(token, for: WatchSecretKey.token)
        secretStore.setString(sessionToken, for: WatchSecretKey.sessionToken)
    }

    private func migrateLegacySecrets() {
        if let legacyToken = defaults.string(forKey: WatchDefaultsKey.legacyToken), !legacyToken.isEmpty {
            secretStore.setString(secretStore.string(for: WatchSecretKey.token) ?? legacyToken, for: WatchSecretKey.token)
            defaults.removeObject(forKey: WatchDefaultsKey.legacyToken)
        }
        if let legacySessionToken = defaults.string(forKey: WatchDefaultsKey.legacySessionToken), !legacySessionToken.isEmpty {
            secretStore.setString(secretStore.string(for: WatchSecretKey.sessionToken) ?? legacySessionToken, for: WatchSecretKey.sessionToken)
            defaults.removeObject(forKey: WatchDefaultsKey.legacySessionToken)
        }
    }

    private static func userFacingMessage(for error: Error) -> String {
        if let validationError = error as? WatchValidationError {
            return validationError.errorDescription ?? "Watch configuration is invalid."
        }
        if let collectorError = error as? OpenVitalsCollectorError {
            switch collectorError {
            case .healthDataUnavailable:
                return "HealthKit is unavailable on this Apple Watch."
            case .invalidResponse:
                return "OpenVitals or HealthKit returned an unexpected response."
            case .httpError(let status, let message):
                return "OpenVitals API error \(status): \(message)"
            case .invalidMirrorRecord:
                return "Live workout records must be direct Apple Watch samples, not mirrored records."
            case .missingHealthKitType(let type):
                return "HealthKit type is unavailable: \(type)."
            case .invalidAnchor(let message):
                return "Stored HealthKit anchor is invalid: \(message)"
            }
        }
        return String(describing: error)
    }

    private static let displayDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .medium
        return formatter
    }()
}

private enum WatchValidationError: LocalizedError {
    case invalidBaseURL
    case missingUserId
    case missingBearerToken

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Enter a reachable http(s) API URL."
        case .missingUserId:
            return "Enter the user ID/profile."
        case .missingBearerToken:
            return "Enter the bearer token from the iPhone/OpenVitals setup."
        }
    }
}

private enum WatchDefaultsKey {
    static let baseURL = "openvitals.watch.baseURL"
    static let userId = "openvitals.watch.userId"
    static let legacyToken = "openvitals.watch.token"
    static let legacySessionToken = "openvitals.watch.sessionToken"
}

private enum WatchSecretKey {
    static let token = "openvitals.watch.token"
    static let sessionToken = "openvitals.watch.sessionToken"
}

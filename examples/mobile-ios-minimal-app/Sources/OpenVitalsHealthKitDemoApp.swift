import Foundation
import HealthKit
import SwiftUI

@main
struct OpenVitalsHealthKitDemoApp: App {
    var body: some Scene {
        WindowGroup {
            CollectorDashboardView()
        }
    }
}

struct CollectorDashboardView: View {
    @StateObject private var model = CollectorDashboardModel()

    var body: some View {
        NavigationStack {
            Form {
                connectionSection
                healthKitSection
                syncSection
                backgroundSection
                statusSection
                watchSection
                troubleshootingSection
            }
            .navigationTitle("OpenVitals")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        model.persistSettingsOnly()
                    }
                }
            }
            .onAppear {
                model.refreshLocalHealthKitState()
                model.runLaunchAutomationIfRequested()
            }
        }
    }

    private var connectionSection: some View {
        Section("iPhone companion setup") {
            TextField("API base URL", text: $model.baseURLString)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .autocorrectionDisabled()
            TextField("User ID", text: $model.userId)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Bearer token", text: $model.token)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("Session token", text: $model.sessionToken)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("Initial lookback days", text: $model.lookbackDaysString)
                .keyboardType(.numberPad)

            if let warning = model.configurationWarning {
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            } else {
                Label("Configured for iPhone-hosted Apple Health sync.", systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.green)
            }

            Text("Use `http://<Mac-LAN-IP>:3000` for physical-device testing. The iPhone app is the required Apple Health connector; the Watch app is optional.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var healthKitSection: some View {
        Section("HealthKit onboarding") {
            StatusRow(title: "Health data", value: model.healthDataAvailability, systemImage: "heart.text.square", tint: model.healthDataAvailable ? .green : .red)
            StatusRow(title: "Authorization", value: model.authorizationState, systemImage: "lock.shield", tint: model.authorizationRequested ? .green : .orange)
            StatusRow(title: "Workout write", value: model.workoutShareStatus, systemImage: "figure.run", tint: model.workoutShareTint)

            Button {
                model.runAuthorization()
            } label: {
                Label("Request HealthKit Permission", systemImage: "heart.text.square")
            }
            .disabled(model.isRunning)

            Text("iOS hides read-permission details after the prompt. If sync fails after authorization, reopen Settings > Health > Data Access & Devices and confirm OpenVitals can read heart rate, HRV, resting heart rate, steps, sleep, and workouts.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var syncSection: some View {
        Section("Sync") {
            Button {
                model.createSession()
            } label: {
                Label("Connect Apple Health Session", systemImage: "link")
            }
            .disabled(model.isRunning)

            Button {
                model.runInitialSync()
            } label: {
                Label("Initial Sync", systemImage: "arrow.down.heart")
            }
            .disabled(model.isRunning)

            Button {
                model.syncNow()
            } label: {
                Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
            }
            .disabled(model.isRunning)

            StatusRow(title: "State", value: model.state, systemImage: model.isRunning ? "hourglass" : "waveform.path.ecg", tint: model.stateTint)
            LabeledContent("Uploaded", value: "\(model.uploadedRecordCount)")
            LabeledContent("Deleted", value: "\(model.deletedObjectCount)")
            LabeledContent("Last sync", value: model.lastSyncText)
            LabeledContent("Staleness", value: model.stalenessText)

            if model.isStale {
                Label("HealthKit sync is stale. Tap Sync Now; iOS background delivery is opportunistic, not guaranteed live monitoring.", systemImage: "clock.badge.exclamationmark")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var backgroundSection: some View {
        Section("Background/incremental sync") {
            Button {
                model.enableBackgroundDelivery()
            } label: {
                Label("Enable HealthKit Background Delivery", systemImage: "bell.badge")
            }
            .disabled(model.isRunning)

            StatusRow(title: "Registration", value: model.backgroundDeliveryState, systemImage: "bell", tint: model.backgroundDeliveryTint)
            LabeledContent("Registered types", value: model.backgroundDeliveryTypesText)

            Text("Background delivery reuses the same anchored queries as Sync Now when iOS wakes the app. Treat it as near-realtime when scheduled by iOS; only the optional Watch workout path is live.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var statusSection: some View {
        Section("Server status") {
            Button {
                model.refreshStatus()
            } label: {
                Label("Refresh Sync Status", systemImage: "list.bullet.rectangle")
            }
            .disabled(model.isRunning)

            LabeledContent("Server auth", value: model.serverAuthState)
            LabeledContent("Credential expires", value: model.credentialExpiryText)
            LabeledContent("Last status", value: model.lastStatusRefreshText)

            if let lastCredentialError = model.lastCredentialError, !lastCredentialError.isEmpty {
                Label(lastCredentialError, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            if let anchor = model.anchorPreview, !anchor.isEmpty {
                DisclosureGroup("Anchor preview") {
                    Text(anchor)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                }
            }
        }
    }

    private var watchSection: some View {
        Section("Optional Apple Watch live mode") {
            Label("Normal Apple Watch history syncs through iPhone HealthKit after Watch data lands in Apple Health.", systemImage: "iphone")
                .font(.footnote)
            Label("Install/run the Watch target only for explicit live workout heart-rate capture.", systemImage: "applewatch")
                .font(.footnote)
            Text("Historical HealthKit records stay `sample`/`episode` with delayed-sync semantics. The Watch workout app is the only path that emits `live_signal` + `live` records.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var troubleshootingSection: some View {
        Section("Troubleshooting") {
            if let error = model.errorMessage {
                Label(error, systemImage: "xmark.octagon.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            Text("Failure states covered here: missing endpoint/token/user, HealthKit unavailable or declined, failed session creation, failed ingest, stale sync status, and server credential errors.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Text("Mirrored Oura/WHOOP records found in Apple Health are uploaded as mirrored sources for dedupe and should not be counted as direct Apple Watch samples.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

private struct StatusRow: View {
    let title: String
    let value: String
    let systemImage: String
    let tint: Color

    var body: some View {
        LabeledContent {
            Label(value, systemImage: systemImage)
                .foregroundStyle(tint)
        } label: {
            Text(title)
        }
    }
}

@MainActor
final class CollectorDashboardModel: ObservableObject {
    @Published var baseURLString: String
    @Published var userId: String
    @Published var token: String
    @Published var sessionToken: String
    @Published var lookbackDaysString: String
    @Published var state = "idle"
    @Published var isRunning = false
    @Published var uploadedRecordCount = 0
    @Published var deletedObjectCount = 0
    @Published var anchorPreview: String?
    @Published var errorMessage: String?
    @Published var healthDataAvailability = "unknown"
    @Published var healthDataAvailable = false
    @Published var authorizationRequested = false
    @Published var workoutShareStatus = "unknown"
    @Published var lastSyncAt: Date?
    @Published var lastStatusRefreshAt: Date?
    @Published var serverAuthState = "unknown"
    @Published var credentialExpiresAt: String?
    @Published var lastCredentialError: String?
    @Published var backgroundDeliveryState = "not enabled"
    @Published var backgroundDeliveryTypes: [String] = []

    private let defaults = UserDefaults.standard
    private let secretStore = KeychainSecretStore(service: "ai.openvitals.ios-companion")
    private let anchorStore = UserDefaultsAnchorStore()
    private let healthStore = HKHealthStore()
    private var launchAutomationRequested = false
    private var launchMaxRecordsPerType: Int?

    init() {
        baseURLString = defaults.string(forKey: DefaultsKey.baseURL) ?? "http://127.0.0.1:3000"
        userId = defaults.string(forKey: DefaultsKey.userId) ?? "user_live"
        token = secretStore.string(for: SecretKey.token) ?? defaults.string(forKey: DefaultsKey.legacyToken) ?? ""
        sessionToken = secretStore.string(for: SecretKey.sessionToken) ?? defaults.string(forKey: DefaultsKey.legacySessionToken) ?? ""
        lookbackDaysString = defaults.string(forKey: DefaultsKey.lookbackDays) ?? "30"
        authorizationRequested = defaults.bool(forKey: DefaultsKey.authorizationRequested)
        backgroundDeliveryState = defaults.string(forKey: DefaultsKey.backgroundDeliveryState) ?? "not enabled"
        backgroundDeliveryTypes = defaults.stringArray(forKey: DefaultsKey.backgroundDeliveryTypes) ?? []
        migrateLegacySecrets()
        let storedLastSync = defaults.double(forKey: DefaultsKey.lastSyncAt)
        if storedLastSync > 0 {
            lastSyncAt = Date(timeIntervalSince1970: storedLastSync)
        }
        let storedLastStatus = defaults.double(forKey: DefaultsKey.lastStatusRefreshAt)
        if storedLastStatus > 0 {
            lastStatusRefreshAt = Date(timeIntervalSince1970: storedLastStatus)
        }
        applyLaunchEnvironmentOverrides()
        refreshLocalHealthKitState()
    }

    var configurationWarning: String? {
        do {
            _ = try validatedBaseURL()
            _ = try validatedUserId()
            _ = try validatedBearerToken()
            return nil
        } catch {
            return userFacingMessage(for: error)
        }
    }

    var authorizationState: String {
        authorizationRequested ? "requested on this device" : "not requested"
    }

    var workoutShareTint: Color {
        switch workoutShareStatus {
        case "sharing authorized": return .green
        case "sharing denied": return .red
        default: return .orange
        }
    }

    var stateTint: Color {
        if isRunning { return .blue }
        if state.lowercased().contains("failed") { return .red }
        if state == "idle" { return .secondary }
        return .green
    }

    var backgroundDeliveryTint: Color {
        backgroundDeliveryState.hasPrefix("enabled") ? .green : .orange
    }

    var backgroundDeliveryTypesText: String {
        backgroundDeliveryTypes.isEmpty ? "none" : backgroundDeliveryTypes.joined(separator: ", ")
    }

    var lastSyncText: String {
        lastSyncAt.map(Self.displayDateFormatter.string(from:)) ?? "never"
    }

    var lastStatusRefreshText: String {
        lastStatusRefreshAt.map(Self.displayDateFormatter.string(from:)) ?? "never"
    }

    var credentialExpiryText: String {
        credentialExpiresAt ?? "unknown"
    }

    var isStale: Bool {
        guard let lastSyncAt else { return authorizationRequested }
        return Date().timeIntervalSince(lastSyncAt) > 24 * 60 * 60
    }

    var stalenessText: String {
        guard let lastSyncAt else { return authorizationRequested ? "needs first sync" : "not started" }
        let hours = Int(Date().timeIntervalSince(lastSyncAt) / 3_600)
        if hours < 1 { return "fresh" }
        if hours < 24 { return "\(hours)h old" }
        return "stale (\(hours / 24)d old)"
    }

    func refreshLocalHealthKitState() {
        healthDataAvailable = HKHealthStore.isHealthDataAvailable()
        healthDataAvailability = healthDataAvailable ? "available" : "unavailable"
        let status = healthStore.authorizationStatus(for: HKObjectType.workoutType())
        workoutShareStatus = Self.shareStatusLabel(status)
    }

    func persistSettingsOnly() {
        persistSettings()
        state = "settings saved"
        errorMessage = nil
    }

    func runAuthorization() {
        runTask(runningState: "requesting HealthKit", successState: "HealthKit authorized") { collector in
            try await collector.requestAuthorization()
            self.authorizationRequested = true
            self.defaults.set(true, forKey: DefaultsKey.authorizationRequested)
            self.refreshLocalHealthKitState()
        }
    }

    func createSession() {
        runTask(runningState: "creating session", successState: "session ready") { collector in
            let response = try await collector.createAppleSession(userId: try self.validatedUserId())
            self.sessionToken = response.sessionToken
            self.credentialExpiresAt = response.expiresAt
            self.secretStore.setString(response.sessionToken, for: SecretKey.sessionToken)
            self.state = "session ready for apple-health"
        }
    }

    func runInitialSync() {
        runSync(runningState: "initial sync", successState: "initial sync complete", lookbackDays: validatedLookbackDays())
    }

    func runLaunchAutomationIfRequested() {
        guard launchAutomationRequested, !isRunning else { return }
        launchAutomationRequested = false
        Self.logHardwareQA("launch automation started")
        runTask(runningState: "hardware QA sync", successState: "hardware QA sync complete") { collector in
            Self.logHardwareQA("requesting HealthKit authorization")
            try await collector.requestAuthorization()
            Self.logHardwareQA("HealthKit authorization returned")
            self.authorizationRequested = true
            self.defaults.set(true, forKey: DefaultsKey.authorizationRequested)

            let activeUserId = try self.validatedUserId()
            Self.logHardwareQA("ensuring connector session")
            let activeSessionToken = try await self.ensureSessionToken(collector: collector, userId: activeUserId)
            Self.logHardwareQA("connector session ready")
            Self.logHardwareQA("collecting anchored HealthKit records")
            let summary = try await collector.collectAndUploadAnchoredBatch(
                userId: activeUserId,
                sessionToken: activeSessionToken,
                anchorStore: self.anchorStore,
                lookbackDays: self.validatedLookbackDays(),
                maxRecordsPerTypeForSmoke: self.launchMaxRecordsPerType
            )
            self.uploadedRecordCount = summary.uploadedRecordCount
            self.deletedObjectCount = summary.deletedObjectCount
            self.anchorPreview = summary.anchorAfter
            self.lastSyncAt = Date()
            self.defaults.set(self.lastSyncAt?.timeIntervalSince1970 ?? 0, forKey: DefaultsKey.lastSyncAt)
            Self.logHardwareQA("launch automation uploaded \(summary.uploadedRecordCount) records")
        }
    }

    func syncNow() {
        runSync(runningState: "syncing", successState: "sync complete", lookbackDays: min(validatedLookbackDays(), 7))
    }

    func refreshStatus() {
        runTask(runningState: "refreshing status", successState: "status refreshed") { collector in
            let activeUserId = try self.validatedUserId()
            let status = try await collector.syncStatus(userId: activeUserId)
            let source = status.sources.first { $0.providerId == "apple-health" }
            self.serverAuthState = source?.authState ?? "missing"
            self.anchorPreview = source?.lastAnchor ?? self.anchorStore.anchor(for: "apple-health", userId: activeUserId)
            self.credentialExpiresAt = source?.credentialExpiresAt
            self.lastCredentialError = source?.lastCredentialError
            self.lastStatusRefreshAt = Date()
            self.defaults.set(self.lastStatusRefreshAt?.timeIntervalSince1970 ?? 0, forKey: DefaultsKey.lastStatusRefreshAt)
        }
    }

    func enableBackgroundDelivery() {
        runTask(runningState: "enabling background delivery", successState: "background delivery enabled") { collector in
            try await collector.requestAuthorization()
            let registeredTypes = try await collector.enableBackgroundDeliveryForAnchoredTypes(frequency: .hourly)
            self.authorizationRequested = true
            self.backgroundDeliveryTypes = registeredTypes
            self.backgroundDeliveryState = "enabled; iOS scheduled"
            self.defaults.set(true, forKey: DefaultsKey.authorizationRequested)
            self.defaults.set(self.backgroundDeliveryState, forKey: DefaultsKey.backgroundDeliveryState)
            self.defaults.set(registeredTypes, forKey: DefaultsKey.backgroundDeliveryTypes)
            self.refreshLocalHealthKitState()
        }
    }

    private func runSync(runningState: String, successState: String, lookbackDays: Int) {
        runTask(runningState: runningState, successState: successState) { collector in
            let activeUserId = try self.validatedUserId()
            let activeSessionToken = try await self.ensureSessionToken(collector: collector, userId: activeUserId)
            let summary = try await collector.collectAndUploadAnchoredBatch(
                userId: activeUserId,
                sessionToken: activeSessionToken,
                anchorStore: self.anchorStore,
                lookbackDays: lookbackDays
            )
            self.uploadedRecordCount = summary.uploadedRecordCount
            self.deletedObjectCount = summary.deletedObjectCount
            self.anchorPreview = summary.anchorAfter
            self.lastSyncAt = Date()
            self.defaults.set(self.lastSyncAt?.timeIntervalSince1970 ?? 0, forKey: DefaultsKey.lastSyncAt)
        }
    }

    private func runTask(
        runningState: String,
        successState: String,
        operation: @escaping (OpenVitalsCollector) async throws -> Void
    ) {
        persistSettings()
        isRunning = true
        state = runningState
        errorMessage = nil
        Self.logHardwareQA("\(runningState) started")
        Task { @MainActor in
            do {
                let collector = try makeCollector()
                try await operation(collector)
                if !state.hasPrefix("session ready") {
                    state = successState
                }
                Self.logHardwareQA("\(successState)")
            } catch {
                state = "failed"
                errorMessage = userFacingMessage(for: error)
                Self.logHardwareQA("failed: \(errorMessage ?? String(describing: error))")
            }
            isRunning = false
            refreshLocalHealthKitState()
        }
    }

    private func makeCollector() throws -> OpenVitalsCollector {
        let baseURL = try validatedBaseURL()
        let bearerToken = try validatedBearerToken()
        _ = try validatedUserId()
        return OpenVitalsCollector(baseURL: baseURL, token: bearerToken)
    }

    private func ensureSessionToken(collector: OpenVitalsCollector, userId: String) async throws -> String {
        let trimmedSessionToken = sessionToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedSessionToken.isEmpty {
            return trimmedSessionToken
        }
        let response = try await collector.createAppleSession(userId: userId)
        sessionToken = response.sessionToken
        credentialExpiresAt = response.expiresAt
        secretStore.setString(response.sessionToken, for: SecretKey.sessionToken)
        return response.sessionToken
    }

    private func validatedBaseURL() throws -> URL {
        let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw CompanionValidationError.missingBaseURL }
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host != nil else {
            throw CompanionValidationError.invalidBaseURL
        }
        return url
    }

    private func validatedUserId() throws -> String {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw CompanionValidationError.missingUserId }
        return trimmed
    }

    private func validatedBearerToken() throws -> String {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw CompanionValidationError.missingBearerToken }
        return trimmed
    }

    private func validatedLookbackDays() -> Int {
        let raw = Int(lookbackDaysString.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 30
        return min(max(raw, 1), 365)
    }

    private func persistSettings() {
        defaults.set(baseURLString.trimmingCharacters(in: .whitespacesAndNewlines), forKey: DefaultsKey.baseURL)
        defaults.set(userId.trimmingCharacters(in: .whitespacesAndNewlines), forKey: DefaultsKey.userId)
        secretStore.setString(token, for: SecretKey.token)
        secretStore.setString(sessionToken, for: SecretKey.sessionToken)
        defaults.set(lookbackDaysString.trimmingCharacters(in: .whitespacesAndNewlines), forKey: DefaultsKey.lookbackDays)
    }

    private func migrateLegacySecrets() {
        if let legacyToken = defaults.string(forKey: DefaultsKey.legacyToken), !legacyToken.isEmpty {
            secretStore.setString(secretStore.string(for: SecretKey.token) ?? legacyToken, for: SecretKey.token)
            defaults.removeObject(forKey: DefaultsKey.legacyToken)
        }
        if let legacySessionToken = defaults.string(forKey: DefaultsKey.legacySessionToken), !legacySessionToken.isEmpty {
            secretStore.setString(secretStore.string(for: SecretKey.sessionToken) ?? legacySessionToken, for: SecretKey.sessionToken)
            defaults.removeObject(forKey: DefaultsKey.legacySessionToken)
        }
    }

    private func applyLaunchEnvironmentOverrides() {
        let environment = ProcessInfo.processInfo.environment
        var didApplyBearerToken = false
        var didApplySessionToken = false
        var didRequestLaunchAutomation = false
        if let value = Self.launchEnvironmentValue("OPENVITALS_IOS_BASE_URL", in: environment) {
            baseURLString = value
            defaults.set(value, forKey: DefaultsKey.baseURL)
            Self.logHardwareQA("launch env applied: base URL")
        }
        if let value = Self.launchEnvironmentValue("OPENVITALS_IOS_USER_ID", in: environment) {
            userId = value
            defaults.set(value, forKey: DefaultsKey.userId)
            Self.logHardwareQA("launch env applied: user id \(value)")
        }
        if let value = Self.launchEnvironmentValue("OPENVITALS_IOS_BEARER_TOKEN", in: environment) {
            token = value
            secretStore.setString(value, for: SecretKey.token)
            didApplyBearerToken = true
            Self.logHardwareQA("launch env applied: bearer token")
        }
        if let value = Self.launchEnvironmentValue("OPENVITALS_IOS_SESSION_TOKEN", in: environment) {
            sessionToken = value
            secretStore.setString(value, for: SecretKey.sessionToken)
            didApplySessionToken = true
            Self.logHardwareQA("launch env applied: session token")
        }
        if let value = Self.launchEnvironmentValue("OPENVITALS_IOS_LOOKBACK_DAYS", in: environment) {
            lookbackDaysString = value
            defaults.set(value, forKey: DefaultsKey.lookbackDays)
            Self.logHardwareQA("launch env applied: lookback days \(value)")
        }
        if let value = Self.launchEnvironmentValue("OPENVITALS_IOS_MAX_RECORDS_PER_TYPE", in: environment), let limit = Int(value), limit > 0 {
            launchMaxRecordsPerType = limit
            Self.logHardwareQA("launch env applied: max records per type \(limit)")
        }
        if Self.launchEnvironmentFlag("OPENVITALS_IOS_AUTO_QA", in: environment) {
            launchAutomationRequested = true
            didRequestLaunchAutomation = true
            Self.logHardwareQA("launch env applied: auto QA")
        }
        if didRequestLaunchAutomation && didApplyBearerToken && !didApplySessionToken {
            sessionToken = ""
            secretStore.setString("", for: SecretKey.sessionToken)
            Self.logHardwareQA("launch env cleared stale session token")
        }
    }

    private static func launchEnvironmentValue(_ key: String, in environment: [String: String]) -> String? {
        let trimmed = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func launchEnvironmentFlag(_ key: String, in environment: [String: String]) -> Bool {
        switch environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "1", "true", "yes", "on":
            return true
        default:
            return false
        }
    }

    private func userFacingMessage(for error: Error) -> String {
        if let validationError = error as? CompanionValidationError {
            return validationError.errorDescription ?? "Configuration is invalid."
        }
        if let collectorError = error as? OpenVitalsCollectorError {
            switch collectorError {
            case .healthDataUnavailable:
                return "HealthKit is unavailable on this device. Use a physical iPhone for final hardware QA."
            case .invalidResponse:
                return "OpenVitals returned an unexpected response, or HealthKit permission was declined."
            case .httpError(let status, let message):
                return "OpenVitals API error \(status): \(message)"
            case .invalidMirrorRecord:
                return "Mirrored HealthKit records must include a bundle identifier for dedupe."
            case .missingHealthKitType(let type):
                return "HealthKit type is unavailable: \(type)."
            case .invalidAnchor(let message):
                return "Stored HealthKit anchor is invalid: \(message)"
            }
        }
        return String(describing: error)
    }

    private static func shareStatusLabel(_ status: HKAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "not determined"
        case .sharingDenied: return "sharing denied"
        case .sharingAuthorized: return "sharing authorized"
        @unknown default: return "unknown"
        }
    }

    private static func logHardwareQA(_ message: String) {
        print("[OpenVitalsHardwareQA] \(message)")
    }

    private static let displayDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .medium
        return formatter
    }()
}

private enum CompanionValidationError: LocalizedError {
    case missingBaseURL
    case invalidBaseURL
    case missingUserId
    case missingBearerToken

    var errorDescription: String? {
        switch self {
        case .missingBaseURL:
            return "Enter an OpenVitals API base URL."
        case .invalidBaseURL:
            return "Enter a valid http(s) OpenVitals API URL."
        case .missingUserId:
            return "Enter the OpenVitals user ID/profile to sync."
        case .missingBearerToken:
            return "Enter a bearer token before connecting or syncing."
        }
    }
}

private enum DefaultsKey {
    static let baseURL = "openvitals.demo.baseURL"
    static let userId = "openvitals.demo.userId"
    static let legacyToken = "openvitals.demo.token"
    static let legacySessionToken = "openvitals.demo.sessionToken"
    static let lookbackDays = "openvitals.demo.lookbackDays"
    static let authorizationRequested = "openvitals.demo.authorizationRequested"
    static let lastSyncAt = "openvitals.demo.lastSyncAt"
    static let lastStatusRefreshAt = "openvitals.demo.lastStatusRefreshAt"
    static let backgroundDeliveryState = "openvitals.demo.backgroundDeliveryState"
    static let backgroundDeliveryTypes = "openvitals.demo.backgroundDeliveryTypes"
}

private enum SecretKey {
    static let token = "openvitals.demo.token"
    static let sessionToken = "openvitals.demo.sessionToken"
}

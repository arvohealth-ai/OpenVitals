import Foundation
import Darwin
import HealthKit
import Security
#if os(iOS)
import UIKit
#elseif os(watchOS)
import WatchKit
#endif

struct ConnectSessionResponse: Decodable {
    let userId: String
    let providerId: String
    let sessionToken: String
    let expiresAt: String
}

struct SyncStatusResponse: Decodable {
    struct Source: Decodable {
        let providerId: String
        let authState: String?
        let lastAnchor: String?
        let credentialExpiresAt: String?
        let lastCredentialError: String?
    }
    let userId: String
    let sources: [Source]
}

struct IngestRecordPayload: Encodable, Sendable {
    let id: String
    let sourceRecordId: String
    let metricFamily: String
    let kind: String
    let metric: String
    let value: Double?
    let normalizedValue: Double?
    let episodeType: String?
    let title: String?
    let metrics: [String: Double]?
    let notes: String?
    let unit: String
    let startAt: String
    let endAt: String
    let timezone: String
    let captureMode: String
    let sourceApp: String
    let bundleId: String?
    let confidence: Double
    let tags: [String]

    // These fields are forward-compatible data-quality hints. Current servers may strip
    // unknown keys, but keeping them in the mobile payload makes the app contract honest
    // when the API contracts add first-class dataGranularity/latencyClass fields.
    let dataGranularity: String?
    let latencyClass: String?
    let connectionMode: String?
    let sourceName: String?
    let sourceRevision: String?
    let deviceModel: String?
    let deviceLocalIdentifier: String?
    let productType: String?
}

struct CollectorMetaPayload: Encodable {
    let sdk: String
    let sdkVersion: String
    let appBuild: String
    let deviceModel: String
}

private struct IngestBatchPayload: Encodable {
    let sessionToken: String
    let idempotencyKey: String
    let anchorBefore: String?
    let anchorAfter: String?
    let collectorMeta: CollectorMetaPayload?
    let records: [IngestRecordPayload]
}

struct AnchoredSyncSummary {
    let anchorBefore: String?
    let anchorAfter: String?
    let uploadedRecordCount: Int
    let deletedObjectCount: Int
}

protocol AnchorStore: Sendable {
    func anchor(for providerId: String, userId: String) -> String?
    func setAnchor(_ anchor: String?, for providerId: String, userId: String)
}

final class UserDefaultsAnchorStore: AnchorStore, @unchecked Sendable {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func anchor(for providerId: String, userId: String) -> String? {
        defaults.string(forKey: key(providerId: providerId, userId: userId))
    }

    func setAnchor(_ anchor: String?, for providerId: String, userId: String) {
        let storageKey = key(providerId: providerId, userId: userId)
        if let anchor {
            defaults.set(anchor, forKey: storageKey)
        } else {
            defaults.removeObject(forKey: storageKey)
        }
    }

    private func key(providerId: String, userId: String) -> String {
        "openvitals.anchor.\(providerId).\(userId)"
    }
}

final class KeychainSecretStore: @unchecked Sendable {
    private let service: String

    init(service: String) {
        self.service = service
    }

    func string(for account: String) -> String? {
        var query = baseQuery(account: account)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    func setString(_ value: String, for account: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            delete(account: account)
            return
        }

        let data = Data(trimmed.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(baseQuery(account: account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var addQuery = baseQuery(account: account)
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(addQuery as CFDictionary, nil)
        }
    }

    func delete(account: String) {
        SecItemDelete(baseQuery(account: account) as CFDictionary)
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

enum OpenVitalsCollectorError: Error {
    case healthDataUnavailable
    case invalidResponse
    case httpError(status: Int, message: String)
    case invalidMirrorRecord
    case missingHealthKitType(String)
    case invalidAnchor(String)
}

private struct HealthKitAnchorEnvelope: Codable {
    var anchors: [String: String]
    var generatedAt: String
}

private struct HealthKitQueryResult {
    let key: String
    let records: [IngestRecordPayload]
    let anchorToken: String?
    let deletedObjectCount: Int
}

private struct SampleSourceMetadata {
    let captureMode: String
    let sourceApp: String
    let bundleId: String?
    let confidence: Double
    let sourceName: String?
    let sourceRevision: String?
    let deviceModel: String?
    let deviceLocalIdentifier: String?
    let productType: String?
    let tags: [String]
}

final class OpenVitalsCollector: @unchecked Sendable {
    private let baseURL: URL
    private let token: String
    private let session: URLSession
    private let healthStore = HKHealthStore()
    private let isoFormatter = ISO8601DateFormatter()
    private let maxIngestRecordsPerBatch = 10
    private static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 180
        configuration.timeoutIntervalForResource = 300
        return URLSession(configuration: configuration)
    }()

    private let mirroredBundleIds: Set<String> = [
        "com.whoop.mobile",
        "com.whoop.ios",
        "com.ouraring.oura",
        "com.oura.health"
    ]

    init(baseURL: URL, token: String, session: URLSession = OpenVitalsCollector.defaultSession) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw OpenVitalsCollectorError.healthDataUnavailable
        }

        var readTypes = Set<HKObjectType>()
        for quantityIdentifier in [
            HKQuantityTypeIdentifier.heartRate,
            HKQuantityTypeIdentifier.heartRateVariabilitySDNN,
            HKQuantityTypeIdentifier.restingHeartRate,
            HKQuantityTypeIdentifier.stepCount
        ] {
            if let quantityType = HKObjectType.quantityType(forIdentifier: quantityIdentifier) {
                readTypes.insert(quantityType)
            }
        }
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            readTypes.insert(sleepType)
        }
        let workoutType = HKObjectType.workoutType()
        readTypes.insert(workoutType)
        let shareTypes: Set<HKSampleType> = [workoutType]

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: OpenVitalsCollectorError.invalidResponse)
                }
            }
        }
    }

    func createAppleSession(userId: String) async throws -> ConnectSessionResponse {
        let path = "/v1/users/\(userId)/connect/apple-health/session"
        let request = try makeRequest(path: path, method: "POST")
        return try await send(request, expecting: ConnectSessionResponse.self)
    }

    func syncStatus(userId: String) async throws -> SyncStatusResponse {
        let path = "/v1/users/\(userId)/sync-status"
        let request = try makeRequest(path: path, method: "GET")
        return try await send(request, expecting: SyncStatusResponse.self)
    }

    #if os(iOS)
    func enableBackgroundDeliveryForAnchoredTypes(frequency: HKUpdateFrequency = .hourly) async throws -> [String] {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw OpenVitalsCollectorError.healthDataUnavailable
        }

        var enabledTypeKeys: [String] = []
        for descriptor in Self.anchoredHealthKitSampleTypes() {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                healthStore.enableBackgroundDelivery(for: descriptor.sampleType, frequency: frequency) { success, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if success {
                        continuation.resume()
                    } else {
                        continuation.resume(throwing: OpenVitalsCollectorError.invalidResponse)
                    }
                }
            }
            enabledTypeKeys.append(descriptor.key)
        }
        return enabledTypeKeys
    }

    private static func anchoredHealthKitSampleTypes() -> [(key: String, sampleType: HKSampleType)] {
        var sampleTypes: [(key: String, sampleType: HKSampleType)] = []
        let quantityTypes: [(String, HKQuantityTypeIdentifier)] = [
            ("heart_rate", .heartRate),
            ("hrv_sdnn", .heartRateVariabilitySDNN),
            ("resting_heart_rate", .restingHeartRate),
            ("steps", .stepCount)
        ]
        for (key, identifier) in quantityTypes {
            if let quantityType = HKObjectType.quantityType(forIdentifier: identifier) {
                sampleTypes.append((key: key, sampleType: quantityType))
            }
        }
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            sampleTypes.append((key: "sleep_analysis", sampleType: sleepType))
        }
        sampleTypes.append((key: "workouts", sampleType: HKObjectType.workoutType()))
        return sampleTypes
    }
    #endif

    func collectAndUploadAnchoredBatch(
        userId: String,
        sessionToken: String,
        anchorStore: AnchorStore,
        lookbackDays: Int = 30,
        collectorMeta: CollectorMetaPayload = .defaultValue,
        maxRecordsPerTypeForSmoke: Int? = nil
    ) async throws -> AnchoredSyncSummary {
        let anchorBefore = anchorStore.anchor(for: "apple-health", userId: userId)
        var envelope = try decodeAnchorEnvelope(anchorBefore)
        let initialStartDate = Calendar.current.date(byAdding: .day, value: -lookbackDays, to: Date()) ?? Date(timeIntervalSinceNow: -30 * 86_400)

        logHardwareQA("querying HealthKit heart_rate")
        let heartRateRecords = try await queryQuantityRecords(
            key: "heart_rate",
            identifier: .heartRate,
            unit: HKUnit.count().unitDivided(by: HKUnit.minute()),
            metricFamily: "cardiovascular",
            metric: "heart_rate",
            dataGranularity: "sample",
            latencyClass: "delayed_sync",
            anchorToken: envelope.anchors["heart_rate"],
            initialStartDate: initialStartDate
        )
        logHardwareQA("HealthKit heart_rate records: \(heartRateRecords.records.count)")

        logHardwareQA("querying HealthKit hrv_sdnn")
        let hrvRecords = try await queryQuantityRecords(
            key: "hrv_sdnn",
            identifier: .heartRateVariabilitySDNN,
            unit: HKUnit.secondUnit(with: .milli),
            metricFamily: "cardiovascular",
            metric: "hrv_sdnn",
            dataGranularity: "sample",
            latencyClass: "delayed_sync",
            anchorToken: envelope.anchors["hrv_sdnn"],
            initialStartDate: initialStartDate
        )
        logHardwareQA("HealthKit hrv_sdnn records: \(hrvRecords.records.count)")

        logHardwareQA("querying HealthKit resting_heart_rate")
        let restingHeartRateRecords = try await queryQuantityRecords(
            key: "resting_heart_rate",
            identifier: .restingHeartRate,
            unit: HKUnit.count().unitDivided(by: HKUnit.minute()),
            metricFamily: "cardiovascular",
            metric: "resting_heart_rate",
            dataGranularity: "sample",
            latencyClass: "delayed_sync",
            anchorToken: envelope.anchors["resting_heart_rate"],
            initialStartDate: initialStartDate
        )
        logHardwareQA("HealthKit resting_heart_rate records: \(restingHeartRateRecords.records.count)")

        logHardwareQA("querying HealthKit steps")
        let stepRecords = try await queryQuantityRecords(
            key: "steps",
            identifier: .stepCount,
            unit: HKUnit.count(),
            metricFamily: "activity",
            metric: "steps",
            dataGranularity: "sample",
            latencyClass: "delayed_sync",
            anchorToken: envelope.anchors["steps"],
            initialStartDate: initialStartDate
        )
        logHardwareQA("HealthKit steps records: \(stepRecords.records.count)")

        logHardwareQA("querying HealthKit sleep_analysis")
        let sleepRecords = try await querySleepRecords(
            anchorToken: envelope.anchors["sleep_analysis"],
            initialStartDate: initialStartDate
        )
        logHardwareQA("HealthKit sleep_analysis records: \(sleepRecords.records.count)")

        logHardwareQA("querying HealthKit workouts")
        let workoutRecords = try await queryWorkoutRecords(
            anchorToken: envelope.anchors["workouts"],
            initialStartDate: initialStartDate
        )
        logHardwareQA("HealthKit workouts records: \(workoutRecords.records.count)")

        let queryResults = [
            heartRateRecords,
            hrvRecords,
            restingHeartRateRecords,
            stepRecords,
            sleepRecords,
            workoutRecords
        ]

        let records: [IngestRecordPayload]
        let shouldAdvanceAnchor: Bool
        if let maxRecordsPerTypeForSmoke {
            records = queryResults.flatMap { Array($0.records.prefix(maxRecordsPerTypeForSmoke)) }
            shouldAdvanceAnchor = false
            logHardwareQA("smoke upload capped at \(maxRecordsPerTypeForSmoke) record(s) per type; local anchor will not advance")
        } else {
            records = queryResults.flatMap(\.records)
            shouldAdvanceAnchor = true
        }
        for result in queryResults {
            envelope.anchors[result.key] = result.anchorToken
        }
        envelope.generatedAt = isoString(Date())
        let anchorAfter = try encodeAnchorEnvelope(envelope)

        if !records.isEmpty {
            logHardwareQA("uploading \(records.count) HealthKit records")
            try await uploadAnchoredBatch(
                userId: userId,
                sessionToken: sessionToken,
                anchorStore: anchorStore,
                anchorAfter: shouldAdvanceAnchor ? anchorAfter : anchorBefore,
                records: records,
                collectorMeta: collectorMeta,
                advanceAnchor: shouldAdvanceAnchor
            )
            logHardwareQA("uploaded \(records.count) HealthKit records")
        } else if shouldAdvanceAnchor {
            anchorStore.setAnchor(anchorAfter, for: "apple-health", userId: userId)
            logHardwareQA("no HealthKit records to upload")
        } else {
            logHardwareQA("no HealthKit records to upload")
        }

        return AnchoredSyncSummary(
            anchorBefore: anchorBefore,
            anchorAfter: shouldAdvanceAnchor ? anchorAfter : anchorBefore,
            uploadedRecordCount: records.count,
            deletedObjectCount: queryResults.reduce(0) { $0 + $1.deletedObjectCount }
        )
    }

    func uploadAnchoredBatch(
        userId: String,
        sessionToken: String,
        anchorStore: AnchorStore,
        anchorAfter: String?,
        records: [IngestRecordPayload],
        collectorMeta: CollectorMetaPayload = .defaultValue,
        advanceAnchor: Bool = true
    ) async throws {
        let anchorBefore = anchorStore.anchor(for: "apple-health", userId: userId)
        let chunks = records.chunked(into: maxIngestRecordsPerBatch)
        let idempotencyBase = "apple-\(Date().timeIntervalSince1970)"
        for (index, chunk) in chunks.enumerated() {
            let isLastChunk = index == chunks.count - 1
            logHardwareQA("uploading chunk \(index + 1)/\(chunks.count) with \(chunk.count) record(s)")
            let chunkSessionToken = index == 0 ? sessionToken : try await createAppleSession(userId: userId).sessionToken
            try await ingestAppleBatch(
                userId: userId,
                sessionToken: chunkSessionToken,
                idempotencyKey: "\(idempotencyBase)-part-\(index + 1)-of-\(chunks.count)",
                anchorBefore: anchorBefore,
                anchorAfter: isLastChunk ? anchorAfter : anchorBefore,
                collectorMeta: collectorMeta,
                records: chunk
            )
            logHardwareQA("uploaded chunk \(index + 1)/\(chunks.count)")
        }
        if advanceAnchor {
            anchorStore.setAnchor(anchorAfter, for: "apple-health", userId: userId)
        }
    }

    func ingestAppleBatch(
        userId: String,
        sessionToken: String,
        idempotencyKey: String,
        anchorBefore: String?,
        anchorAfter: String?,
        collectorMeta: CollectorMetaPayload? = .defaultValue,
        records: [IngestRecordPayload]
    ) async throws {
        if records.contains(where: { $0.captureMode == "mirrored" && $0.bundleId == nil }) {
            throw OpenVitalsCollectorError.invalidMirrorRecord
        }

        let payload = IngestBatchPayload(
            sessionToken: sessionToken,
            idempotencyKey: idempotencyKey,
            anchorBefore: anchorBefore,
            anchorAfter: anchorAfter,
            collectorMeta: collectorMeta,
            records: records
        )
        do {
            let path = "/v1/users/\(userId)/ingest/apple-health"
            let request = try makeRequest(path: path, method: "POST", body: payload)
            try await sendWithoutDecoding(request)
        } catch OpenVitalsCollectorError.httpError(let status, _) where status == 400 || status == 409 {
            let statusPayload = try await syncStatus(userId: userId)
            let serverAnchor = statusPayload.sources.first(where: { $0.providerId == "apple-health" })?.lastAnchor
            let retryPayload = IngestBatchPayload(
                sessionToken: sessionToken,
                idempotencyKey: idempotencyKey + "-retry",
                anchorBefore: serverAnchor,
                anchorAfter: anchorAfter,
                collectorMeta: collectorMeta,
                records: records
            )
            let path = "/v1/users/\(userId)/ingest/apple-health"
            let retryRequest = try makeRequest(path: path, method: "POST", body: retryPayload)
            try await sendWithoutDecoding(retryRequest)
        }
    }

    private func logHardwareQA(_ message: String) {
        print("[OpenVitalsHardwareQA] \(message)")
    }

    func buildAppleRecord(
        id: String,
        sourceRecordId: String,
        metricFamily: String,
        metric: String,
        value: Double?,
        unit: String,
        startAt: Date,
        endAt: Date,
        captureMode: String,
        sourceApp: String,
        bundleId: String? = nil,
        kind: String = "observation",
        normalizedValue: Double? = nil,
        episodeType: String? = nil,
        title: String? = nil,
        metrics: [String: Double]? = nil,
        notes: String? = nil,
        confidence: Double? = nil,
        tags: [String] = [],
        dataGranularity: String? = nil,
        latencyClass: String? = nil,
        connectionMode: String? = "mobile_permission",
        sourceName: String? = nil,
        sourceRevision: String? = nil,
        deviceModel: String? = nil,
        deviceLocalIdentifier: String? = nil,
        productType: String? = nil
    ) -> IngestRecordPayload {
        IngestRecordPayload(
            id: id,
            sourceRecordId: sourceRecordId,
            metricFamily: metricFamily,
            kind: kind,
            metric: metric,
            value: value,
            normalizedValue: normalizedValue,
            episodeType: episodeType,
            title: title,
            metrics: metrics,
            notes: notes,
            unit: unit,
            startAt: isoString(startAt),
            endAt: isoString(endAt),
            timezone: TimeZone.current.identifier,
            captureMode: captureMode,
            sourceApp: sourceApp,
            bundleId: bundleId,
            confidence: confidence ?? (captureMode == "mirrored" ? 0.8 : 0.95),
            tags: tags,
            dataGranularity: dataGranularity,
            latencyClass: latencyClass,
            connectionMode: connectionMode,
            sourceName: sourceName,
            sourceRevision: sourceRevision,
            deviceModel: deviceModel,
            deviceLocalIdentifier: deviceLocalIdentifier,
            productType: productType
        )
    }

    private func queryQuantityRecords(
        key: String,
        identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        metricFamily: String,
        metric: String,
        dataGranularity: String,
        latencyClass: String,
        anchorToken: String?,
        initialStartDate: Date
    ) async throws -> HealthKitQueryResult {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            throw OpenVitalsCollectorError.missingHealthKitType(key)
        }
        let anchor = try Self.decodeQueryAnchor(anchorToken)
        let predicate = anchor == nil ? HKQuery.predicateForSamples(withStart: initialStartDate, end: nil, options: []) : nil
        return try await runAnchoredQuery(key: key, sampleType: quantityType, predicate: predicate, anchor: anchor) { sample in
            guard let quantitySample = sample as? HKQuantitySample else { return nil }
            let metadata = self.sourceMetadata(for: quantitySample, dataGranularity: dataGranularity, latencyClass: latencyClass)
            return self.buildAppleRecord(
                id: "apple-health:\(key):\(quantitySample.uuid.uuidString)",
                sourceRecordId: "\(metadata.sourceApp):\(quantitySample.uuid.uuidString)",
                metricFamily: metricFamily,
                metric: metric,
                value: quantitySample.quantity.doubleValue(for: unit),
                unit: unit.unitString,
                startAt: quantitySample.startDate,
                endAt: quantitySample.endDate,
                captureMode: metadata.captureMode,
                sourceApp: metadata.sourceApp,
                bundleId: metadata.bundleId,
                confidence: metadata.confidence,
                tags: metadata.tags,
                dataGranularity: dataGranularity,
                latencyClass: latencyClass,
                sourceName: metadata.sourceName,
                sourceRevision: metadata.sourceRevision,
                deviceModel: metadata.deviceModel,
                deviceLocalIdentifier: metadata.deviceLocalIdentifier,
                productType: metadata.productType
            )
        }
    }

    private func querySleepRecords(anchorToken: String?, initialStartDate: Date) async throws -> HealthKitQueryResult {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            throw OpenVitalsCollectorError.missingHealthKitType("sleep_analysis")
        }
        let anchor = try Self.decodeQueryAnchor(anchorToken)
        let predicate = anchor == nil ? HKQuery.predicateForSamples(withStart: initialStartDate, end: nil, options: []) : nil
        return try await runAnchoredQuery(key: "sleep_analysis", sampleType: sleepType, predicate: predicate, anchor: anchor) { sample in
            guard let categorySample = sample as? HKCategorySample else { return nil }
            let metadata = self.sourceMetadata(for: categorySample, dataGranularity: "episode", latencyClass: "delayed_sync")
            let durationMinutes = max(categorySample.endDate.timeIntervalSince(categorySample.startDate) / 60, 0)
            return self.buildAppleRecord(
                id: "apple-health:sleep:\(categorySample.uuid.uuidString)",
                sourceRecordId: "\(metadata.sourceApp):\(categorySample.uuid.uuidString)",
                metricFamily: "sleep",
                metric: "sleep_analysis",
                value: durationMinutes,
                unit: "minutes",
                startAt: categorySample.startDate,
                endAt: categorySample.endDate,
                captureMode: metadata.captureMode,
                sourceApp: metadata.sourceApp,
                bundleId: metadata.bundleId,
                kind: "episode",
                episodeType: "sleep",
                title: self.sleepStageLabel(categorySample.value),
                metrics: ["duration_minutes": durationMinutes, "healthkit_sleep_stage": Double(categorySample.value)],
                confidence: metadata.confidence,
                tags: metadata.tags,
                dataGranularity: "episode",
                latencyClass: "delayed_sync",
                sourceName: metadata.sourceName,
                sourceRevision: metadata.sourceRevision,
                deviceModel: metadata.deviceModel,
                deviceLocalIdentifier: metadata.deviceLocalIdentifier,
                productType: metadata.productType
            )
        }
    }

    private func queryWorkoutRecords(anchorToken: String?, initialStartDate: Date) async throws -> HealthKitQueryResult {
        let workoutType = HKObjectType.workoutType()
        let anchor = try Self.decodeQueryAnchor(anchorToken)
        let predicate = anchor == nil ? HKQuery.predicateForSamples(withStart: initialStartDate, end: nil, options: []) : nil
        return try await runAnchoredQuery(key: "workouts", sampleType: workoutType, predicate: predicate, anchor: anchor) { sample in
            guard let workout = sample as? HKWorkout else { return nil }
            let metadata = self.sourceMetadata(for: workout, dataGranularity: "episode", latencyClass: "delayed_sync")
            var metrics: [String: Double] = [
                "duration_seconds": workout.duration,
                "activity_type": Double(workout.workoutActivityType.rawValue)
            ]
            #if !os(macOS)
            if let energy = workout.totalEnergyBurned?.doubleValue(for: HKUnit.kilocalorie()) {
                metrics["active_energy_kcal"] = energy
            }
            #endif
            if let distance = workout.totalDistance?.doubleValue(for: HKUnit.meter()) {
                metrics["distance_meters"] = distance
            }
            return self.buildAppleRecord(
                id: "apple-health:workout:\(workout.uuid.uuidString)",
                sourceRecordId: "\(metadata.sourceApp):\(workout.uuid.uuidString)",
                metricFamily: "workout",
                metric: "workout",
                value: workout.duration,
                unit: "seconds",
                startAt: workout.startDate,
                endAt: workout.endDate,
                captureMode: metadata.captureMode,
                sourceApp: metadata.sourceApp,
                bundleId: metadata.bundleId,
                kind: "episode",
                episodeType: "workout",
                title: "HealthKit workout \(workout.workoutActivityType.rawValue)",
                metrics: metrics,
                confidence: metadata.confidence,
                tags: metadata.tags,
                dataGranularity: "episode",
                latencyClass: "delayed_sync",
                sourceName: metadata.sourceName,
                sourceRevision: metadata.sourceRevision,
                deviceModel: metadata.deviceModel,
                deviceLocalIdentifier: metadata.deviceLocalIdentifier,
                productType: metadata.productType
            )
        }
    }

    private func runAnchoredQuery(
        key: String,
        sampleType: HKSampleType,
        predicate: NSPredicate?,
        anchor: HKQueryAnchor?,
        mapSample: @escaping @Sendable (HKSample) -> IngestRecordPayload?
    ) async throws -> HealthKitQueryResult {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HealthKitQueryResult, Error>) in
            let query = HKAnchoredObjectQuery(
                type: sampleType,
                predicate: predicate,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, deletedObjects, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                do {
                    let records = (samples ?? []).compactMap(mapSample)
                    let anchorToken = try Self.encodeQueryAnchor(newAnchor)
                    continuation.resume(
                        returning: HealthKitQueryResult(
                            key: key,
                            records: records,
                            anchorToken: anchorToken,
                            deletedObjectCount: deletedObjects?.count ?? 0
                        )
                    )
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            healthStore.execute(query)
        }
    }

    private func sourceMetadata(for sample: HKSample, dataGranularity: String, latencyClass: String) -> SampleSourceMetadata {
        let sourceRevision = sample.sourceRevision
        let bundleId = sourceRevision.source.bundleIdentifier
        let normalizedBundleId = bundleId.lowercased()
        let captureMode = mirroredBundleIds.contains(normalizedBundleId) ? "mirrored" : "direct"
        let sourceApp = bundleId.isEmpty ? sourceRevision.source.name : bundleId
        let deviceModel = [sample.device?.manufacturer, sample.device?.model]
            .compactMap { $0 }
            .joined(separator: " ")
        let sourceRevisionLabel = [sourceRevision.source.name, sourceRevision.version]
            .compactMap { $0 }
            .joined(separator: " ")
        var tags = [
            "data_granularity:\(dataGranularity)",
            "latency_class:\(latencyClass)",
            "connection_mode:mobile_permission",
            "source_bundle:\(sourceApp)"
        ]
        if captureMode == "mirrored" {
            tags.append("capture_mode:mirrored")
        }
        if let productType = sourceRevision.productType {
            tags.append("source_product:\(productType)")
        }
        if !deviceModel.isEmpty {
            tags.append("device_model:\(deviceModel)")
        }
        return SampleSourceMetadata(
            captureMode: captureMode,
            sourceApp: sourceApp,
            bundleId: bundleId.isEmpty ? nil : bundleId,
            confidence: captureMode == "mirrored" ? 0.8 : 0.95,
            sourceName: sourceRevision.source.name,
            sourceRevision: sourceRevisionLabel.isEmpty ? nil : sourceRevisionLabel,
            deviceModel: deviceModel.isEmpty ? nil : deviceModel,
            deviceLocalIdentifier: sample.device?.localIdentifier,
            productType: sourceRevision.productType,
            tags: tags
        )
    }

    private func decodeAnchorEnvelope(_ rawAnchor: String?) throws -> HealthKitAnchorEnvelope {
        guard let rawAnchor, let data = rawAnchor.data(using: .utf8) else {
            return HealthKitAnchorEnvelope(anchors: [:], generatedAt: isoString(Date()))
        }
        do {
            return try JSONDecoder().decode(HealthKitAnchorEnvelope.self, from: data)
        } catch {
            throw OpenVitalsCollectorError.invalidAnchor("Could not decode HealthKit anchor envelope.")
        }
    }

    private func encodeAnchorEnvelope(_ envelope: HealthKitAnchorEnvelope) throws -> String {
        let data = try JSONEncoder().encode(envelope)
        guard let raw = String(data: data, encoding: .utf8) else {
            throw OpenVitalsCollectorError.invalidAnchor("Could not encode HealthKit anchor envelope.")
        }
        return raw
    }

    private static func decodeQueryAnchor(_ token: String?) throws -> HKQueryAnchor? {
        guard let token else { return nil }
        guard let data = Data(base64Encoded: token) else {
            throw OpenVitalsCollectorError.invalidAnchor("HealthKit query anchor was not base64 encoded.")
        }
        return try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private static func encodeQueryAnchor(_ anchor: HKQueryAnchor?) throws -> String? {
        guard let anchor else { return nil }
        let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        return data.base64EncodedString()
    }

    private func sleepStageLabel(_ value: Int) -> String {
        switch value {
        case 0: return "in_bed"
        case 1: return "asleep"
        case 2: return "awake"
        case 3: return "asleep_core"
        case 4: return "asleep_deep"
        case 5: return "asleep_rem"
        default: return "sleep_stage_\(value)"
        }
    }

    private func makeRequest(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw OpenVitalsCollectorError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func makeRequest<T: Encodable>(path: String, method: String, body: T) throws -> URLRequest {
        var request = try makeRequest(path: path, method: method)
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest, expecting type: T.Type) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OpenVitalsCollectorError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Request failed."
            throw OpenVitalsCollectorError.httpError(status: http.statusCode, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func sendWithoutDecoding(_ request: URLRequest) async throws {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OpenVitalsCollectorError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Request failed."
            throw OpenVitalsCollectorError.httpError(status: http.statusCode, message: message)
        }
    }

    private func isoString(_ date: Date) -> String {
        isoFormatter.string(from: date)
    }
}

#if os(watchOS)
final class AppleWatchLiveWorkoutHeartRateStreamer: NSObject, @unchecked Sendable, HKLiveWorkoutBuilderDelegate, HKWorkoutSessionDelegate {
    private let healthStore: HKHealthStore
    private let collector: OpenVitalsCollector
    private var workoutSession: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    var onHeartRateRecord: ((IngestRecordPayload) -> Void)?
    var onError: ((Error) -> Void)?

    init(healthStore: HKHealthStore = HKHealthStore(), collector: OpenVitalsCollector) {
        self.healthStore = healthStore
        self.collector = collector
    }

    func start(activityType: HKWorkoutActivityType = .other, locationType: HKWorkoutSessionLocationType = .unknown) async throws {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activityType
        configuration.locationType = locationType

        let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
        builder.delegate = self
        session.delegate = self
        self.workoutSession = session
        self.builder = builder

        let startedAt = Date()
        session.startActivity(with: startedAt)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            builder.beginCollection(withStart: startedAt) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: OpenVitalsCollectorError.invalidResponse)
                }
            }
        }
    }

    func stop() async throws {
        workoutSession?.end()
        guard let builder else { return }
        let endedAt = Date()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            builder.endCollection(withEnd: endedAt) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: OpenVitalsCollectorError.invalidResponse)
                }
            }
        }
        _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HKWorkout?, Error>) in
            builder.finishWorkout { workout, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: workout)
                }
            }
        }
    }

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType),
              let heartRate = statistics.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: HKUnit.minute())) else {
            return
        }
        let measuredAt = statistics.endDate
        let record = collector.buildAppleRecord(
            id: "apple-watch:live-workout-heart-rate:\(UUID().uuidString)",
            sourceRecordId: "apple-watch-live-workout:\(Int(measuredAt.timeIntervalSince1970 * 1000))",
            metricFamily: "cardiovascular",
            metric: "live_workout_heart_rate",
            value: heartRate,
            unit: "count/min",
            startAt: statistics.startDate,
            endAt: measuredAt,
            captureMode: "direct",
            sourceApp: "com.apple.Health",
            bundleId: "com.apple.Health",
            confidence: 0.98,
            tags: [
                "data_granularity:live_signal",
                "latency_class:live",
                "connection_mode:device_pairing",
                "source_product:apple_watch"
            ],
            dataGranularity: "live_signal",
            latencyClass: "live",
            connectionMode: "device_pairing",
            sourceName: "Apple Watch live workout",
            deviceModel: WKInterfaceDevice.current().model,
            productType: "apple_watch"
        )
        onHeartRateRecord?(record)
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        onError?(error)
    }
}
#endif

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map { start in
            Array(self[start..<Swift.min(start + size, count)])
        }
    }
}

extension CollectorMetaPayload {
    static var defaultValue: CollectorMetaPayload {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "dev"
        return CollectorMetaPayload(
            sdk: "collector-ios",
            sdkVersion: version,
            appBuild: build,
            deviceModel: currentDeviceModel()
        )
    }

    private static func currentDeviceModel() -> String {
        #if targetEnvironment(simulator)
        if let simulatorModel = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !simulatorModel.isEmpty {
            return simulatorModel
        }
        #endif

        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
                String(cString: $0)
            }
        }
        return machine.isEmpty ? "unknown-apple-device" : machine
    }
}

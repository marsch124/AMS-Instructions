import UIKit
import Vision

// Recognising an item from a photo of it, on the device.
//
// Each teaching photo is reduced to a Vision "feature print" — a fingerprint
// of what the picture shows. A new photo's fingerprint is compared with all of
// them; the smaller the distance, the more alike. No internet, no training.
//
// It works for items that look distinct. Near-identical things (two of the
// same switch) or very different light can fool it — which is why it never
// guesses silently: when the best match is not clearly best, it offers the
// likeliest few to choose from.
enum Recognition {
    /// Below this distance a match is trusted…
    static let acceptDistance: Float = 0.55
    /// …if the next-best instruction is at least this much further away.
    static let clearMargin: Float = 0.08
    /// Above this, nothing is close enough to even suggest.
    static let suggestDistance: Float = 0.85
    static let maxPhotosPerInstruction = 5

    struct Match: Identifiable {
        let instructionUID: String
        let distance: Float
        var id: String { instructionUID }

        /// For people: 100% is identical, 0% is nothing alike.
        var similarity: Int {
            Int((max(0, 1 - distance / suggestDistance) * 100).rounded())
        }
    }

    enum Verdict {
        case match(String)
        case unsure([Match])
        case none
    }

    // MARK: Fingerprints

    static func featurePrint(for image: UIImage) throws -> VNFeaturePrintObservation {
        guard let cgImage = image.cgImage else { throw RecognitionError.noImage }
        let request = VNGenerateImageFeaturePrintRequest()
        // Fixed, so prints made on different iOS versions stay comparable.
        request.revision = VNGenerateImageFeaturePrintRequestRevision2
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation(of: image))
        try handler.perform([request])
        guard let print = request.results?.first else { throw RecognitionError.noPrint }
        return print
    }

    static func archive(_ print: VNFeaturePrintObservation) -> Data? {
        try? NSKeyedArchiver.archivedData(withRootObject: print, requiringSecureCoding: true)
    }

    static func unarchive(_ data: Data?) -> VNFeaturePrintObservation? {
        guard let data else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: data)
    }

    // MARK: Matching

    /// The closest teaching photo per instruction, best first.
    /// Taking plain values rather than the stored records, so the comparing
    /// can happen off the main thread.
    static func rank(_ query: VNFeaturePrintObservation,
                     against prints: [(instructionUID: String, printData: Data?)]) -> [Match] {
        var best: [String: Float] = [:]
        for stored in prints {
            guard let print = unarchive(stored.printData) else { continue }
            var distance: Float = 0
            guard (try? query.computeDistance(&distance, to: print)) != nil else { continue }
            if distance < best[stored.instructionUID] ?? .infinity {
                best[stored.instructionUID] = distance
            }
        }
        return best.map { Match(instructionUID: $0.key, distance: $0.value) }
            .sorted { $0.distance < $1.distance }
    }

    static func verdict(for ranked: [Match]) -> Verdict {
        guard let first = ranked.first, first.distance < suggestDistance else { return .none }
        let second = ranked.dropFirst().first?.distance ?? .infinity
        if first.distance < acceptDistance && second - first.distance >= clearMargin {
            return .match(first.instructionUID)
        }
        return .unsure(Array(ranked.prefix(3).filter { $0.distance < suggestDistance }))
    }

    // MARK: Helpers

    private static func orientation(of image: UIImage) -> CGImagePropertyOrientation {
        switch image.imageOrientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }

    enum RecognitionError: LocalizedError {
        case noImage, noPrint

        var errorDescription: String? {
            switch self {
            case .noImage: return "The photo could not be read."
            case .noPrint: return "The photo could not be analysed."
            }
        }
    }
}

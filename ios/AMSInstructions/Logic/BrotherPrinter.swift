import UIKit
import BRLMPrinterKit

// Straight to a Brother P-touch Cube over Bluetooth — no other app, no
// AirPrint. The Cube (PT-P300BT, PT-P710BT, PT-P910BT) only speaks
// Brother's own protocol, which is why Print… on its own never reached it.
//
// The printer has to be paired once in the iPhone's Settings → Bluetooth.
// After that the app finds it by itself.
enum BrotherPrinter {
    struct Problem: Error {
        let message: String
    }

    /// The Cubes, with the widest tape each one takes.
    private static let models: [(name: String, model: BRLMPrinterModel, maxTapeMM: Int)] = [
        ("P300BT", .PT_P300BT, 12),
        ("P710BT", .PT_P710BT, 24),
        ("P910BT", .PT_P910BT, 36)
    ]

    /// Prints one label per instruction. Slow work (Bluetooth), so it runs off
    /// the main thread; returns the printer's name for the success message.
    @MainActor
    static func print(_ instructions: [Instruction], size: LabelSize) async throws -> String {
        guard let labelSize = tape(for: size) else {
            throw Problem(message: "A P-touch Cube prints on tape. Choose 12, 24 or 36 mm tape above.")
        }
        // Drawn here, on the main thread, where the instructions live.
        let images = instructions.compactMap { Labels.png(for: $0, size: size) }
            .compactMap { UIImage(data: $0)?.cgImage }
        guard !images.isEmpty else { throw Problem(message: "The label could not be drawn.") }
        let tapeMM = Int(size.sizeMM.height)

        return try await Task.detached(priority: .userInitiated) {
            try send(images, labelSize: labelSize, tapeMM: tapeMM)
        }.value
    }

    private static func send(_ images: [CGImage], labelSize: BRLMPTPrintSettingsLabelSize, tapeMM: Int) throws -> String {
        let channels = BRLMPrinterSearcher.startBluetoothSearch().channels
        let found = channels.compactMap { channel -> (BRLMChannel, String, BRLMPrinterModel, Int)? in
            let name = (channel.extraInfo?[BRLMChannelExtraInfoKeyModelName] as? String) ?? ""
            guard let match = models.first(where: { name.uppercased().contains($0.name) }) else { return nil }
            return (channel, name, match.model, match.maxTapeMM)
        }
        guard let (channel, name, model, maxTape) = found.first else {
            throw Problem(message: "No P-touch Cube found. Turn the printer on. The first time, pair it in the iPhone's Settings → Bluetooth, then try again.")
        }
        guard tapeMM <= maxTape else {
            throw Problem(message: "Your \(name) takes tape up to \(maxTape) mm. Choose \(maxTape) mm tape above.")
        }

        let opened = BRLMPrinterDriverGenerator.open(channel)
        guard opened.error.code == .noError, let driver = opened.driver else {
            throw Problem(message: "Could not connect to the \(name). Check that it is on and close by, then try again.")
        }
        defer { driver.closeChannel() }

        guard let settings = BRLMPTPrintSettings(defaultPrintSettingsWith: model) else {
            throw Problem(message: "The \(name) is not supported.")
        }
        settings.labelSize = labelSize
        settings.printOrientation = .landscape
        settings.scaleMode = .fitPaperAspect
        settings.halftone = .threshold
        settings.autoCut = true

        for image in images {
            let error = driver.printImage(with: image, settings: settings)
            guard error.code == .noError else { throw Problem(message: explain(error.code, printer: name)) }
        }
        return name
    }

    private static func tape(for size: LabelSize) -> BRLMPTPrintSettingsLabelSize? {
        switch size {
        case .tape12: return .width12mm
        case .tape24: return .width24mm
        case .tape36: return .width36mm
        case .roll62: return nil
        }
    }

    private static func explain(_ code: BRLMPrintErrorCode, printer: String) -> String {
        switch code {
        case .printerStatusErrorPaperEmpty: return "The \(printer) has no tape. Put a tape cassette in and try again."
        case .printerStatusErrorCoverOpen: return "The \(printer)'s cover is open. Close it and try again."
        case .printerStatusErrorBatteryWeak: return "The \(printer)'s battery is low. Charge it and try again."
        case .printerStatusErrorBusy: return "The \(printer) is busy. Wait a moment and try again."
        case .printerStatusErrorPrinterTurnedOff, .channelTimeout, .printerStatusErrorCommunicationError:
            return "Lost the connection to the \(printer). Check that it is on and close by, then try again."
        case .setLabelSizeError, .printerStatusErrorMediaCannotBeFed:
            return "The tape in the \(printer) does not match the size chosen above. Choose the width of the tape that is in it."
        default: return "The \(printer) could not print (error \(code.rawValue)). Try again."
        }
    }
}

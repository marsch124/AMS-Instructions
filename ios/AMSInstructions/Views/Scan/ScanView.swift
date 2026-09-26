import SwiftUI
import SwiftData
import VisionKit

// Point the camera at a label. Reads either a QR code or the printed number
// itself, and only accepts a number the library actually has — so a stray
// "12V" on a fuse box cannot open the wrong instruction.
struct ScanView: View {
    let onFound: (String) -> Void

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var manualNumber = ""
    @State private var status = "Point the camera at an instruction label."
    /// The scanner reports many frames a second; only the first hit counts.
    @State private var found = false
    @FocusState private var typing: Bool

    private var scannerAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if scannerAvailable {
                    LiveScanner { candidates in
                        accept(candidates)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Palette.brand, lineWidth: 3))
                    .frame(maxHeight: 420)
                } else {
                    ContentUnavailableView("Camera scanning isn’t available",
                                           systemImage: "camera.metering.unknown",
                                           description: Text("Type the number from the label instead."))
                }

                Text(status)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                HStack {
                    TextField("Or type the number, e.g. 001", text: $manualNumber)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                        .focused($typing)
                        .onSubmit(openTyped)
                    Button("Go", action: openTyped)
                        .buttonStyle(.borderedProminent)
                        .disabled(manualNumber.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Spacer(minLength: 0)
            }
            .padding()
            .navigationTitle("Scan Instruction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .onAppear {
                if !scannerAvailable { typing = true }
            }
        }
    }

    private func openTyped() {
        let number = Numbers.normalize(manualNumber)
        guard !number.isEmpty else { return }
        if Library.instruction(number: number, in: context) != nil {
            onFound(number)
        } else {
            status = "There is no instruction \(number)."
        }
    }

    private func accept(_ candidates: [String]) {
        guard !found else { return }
        for number in NumberReader.candidates(in: candidates)
        where Library.instruction(number: number, in: context) != nil {
            found = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onFound(number)
            return
        }
    }
}

enum NumberReader {
    /// "AMS#007" on a label, as text or in a QR code. The camera's text reader
    /// sometimes sees the "#" as "H" or "4"; those count only when exactly
    /// three digits follow, so "AMS 42" is 042 and not 002.
    private static let labelCode = try! NSRegularExpression(
        pattern: #"AMS\s*(?:[#\-]|[H4](?=\d{3}(?!\d)))?\s*(\d{1,3})(?!\d)"#,
        options: [.caseInsensitive]
    )

    /// Numbers in everything the camera sees, most trustworthy first: every
    /// "AMS#…" code before any bare number, so a fuse rating or "12V" beside
    /// the label can never win over the label itself.
    static func candidates(in texts: [String]) -> [String] {
        let coded = texts.flatMap(labelCodes(in:))
        let bare = texts.flatMap(numbers(in:))
        var seen = Set<String>()
        return (coded + bare).filter { seen.insert($0).inserted }
    }

    static func labelCodes(in text: String) -> [String] {
        let range = NSRange(text.startIndex..., in: text)
        return labelCode.matches(in: text, range: range).compactMap { match in
            Range(match.range(at: 1), in: text).map { Numbers.normalize(String(text[$0])) }
        }
    }

    /// Stand-alone groups of one to three digits, padded to three. A QR code
    /// holding just "7" or a URL ending "?n=007" both work — labels printed
    /// before the AMS# prefix keep working.
    static func numbers(in text: String) -> [String] {
        var found: [String] = []
        var current = ""
        for character in text + " " {
            if character.isASCII, character.isNumber {
                current.append(character)
            } else {
                if (1...3).contains(current.count) { found.append(Numbers.normalize(current)) }
                current = ""
            }
        }
        return found
    }
}

/// VisionKit's live scanner, reading QR codes and printed text.
struct LiveScanner: UIViewControllerRepresentable {
    let onRecognized: ([String]) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr]), .text()],
            qualityLevel: .balanced,
            recognizesMultipleItems: true,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        if !scanner.isScanning {
            try? scanner.startScanning()
        }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onRecognized: onRecognized)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onRecognized: ([String]) -> Void

        init(onRecognized: @escaping ([String]) -> Void) {
            self.onRecognized = onRecognized
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
                         allItems: [RecognizedItem]) {
            report(allItems)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem],
                         allItems: [RecognizedItem]) {
            report(allItems)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            report([item])
        }

        private func report(_ items: [RecognizedItem]) {
            // QR codes first: they are unambiguous where printed text is not.
            let codes: [String] = items.compactMap {
                if case .barcode(let code) = $0 { return code.payloadStringValue }
                return nil
            }
            let texts: [String] = items.compactMap {
                if case .text(let text) = $0 { return text.transcript }
                return nil
            }
            let candidates = codes + texts
            if !candidates.isEmpty { onRecognized(candidates) }
        }
    }
}

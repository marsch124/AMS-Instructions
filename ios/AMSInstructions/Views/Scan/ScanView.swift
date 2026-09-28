import SwiftUI
import SwiftData
import VisionKit

// Two ways to find an instruction with the camera:
//   Label — the printed AMS#xxx label (QR code or text). Only numbers the
//           library actually has count, and AMS# codes beat any other
//           number in view, so a stray "12V" cannot open the wrong one.
//   Item  — the item itself, compared with the teaching photos taken on each
//           instruction ("Recognise this item").
struct ScanView: View {
    let onFound: (String) -> Void

    enum Mode: String, CaseIterable {
        case label = "Label"
        case item = "Item"
    }

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var prints: [RecognitionPrint]
    @Query private var instructions: [Instruction]

    @State private var mode: Mode = .label
    @State private var manualNumber = ""
    @State private var status = ""
    /// The scanner reports many frames a second; only the first hit counts.
    @State private var found = false
    @State private var handle = ScannerHandle()
    @State private var recognizing = false
    @State private var suggestions: [Recognition.Match] = []
    @State private var takingPhoto = false
    @FocusState private var typing: Bool

    private var scannerAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Picker("Scan", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if scannerAvailable {
                        LiveScanner(handle: handle) { candidates in
                            accept(candidates)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Palette.brand, lineWidth: 3))
                        .frame(height: 360)
                    } else if mode == .label {
                        ContentUnavailableView("Camera scanning isn’t available",
                                               systemImage: "camera.metering.unknown",
                                               description: Text("Type the number from the label instead."))
                    }

                    switch mode {
                    case .label: labelControls
                    case .item: itemControls
                    }
                }
                .padding()
            }
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
            .onChange(of: mode) { _, _ in
                status = ""
                suggestions = []
            }
            .sheet(isPresented: $takingPhoto) {
                CameraPicker { image in
                    takingPhoto = false
                    if let image { recognize(image) }
                }
                .ignoresSafeArea()
            }
        }
    }

    // MARK: Label

    private var labelControls: some View {
        VStack(spacing: 12) {
            Text(status.isEmpty ? "Point the camera at an AMS# label." : status)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            HStack {
                TextField("Or type the number, e.g. 007", text: $manualNumber)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                    .focused($typing)
                    .onSubmit(openTyped)
                Button("Go", action: openTyped)
                    .buttonStyle(.borderedProminent)
                    .disabled(manualNumber.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func openTyped() {
        let number = Numbers.normalize(manualNumber)
        guard !number.isEmpty else { return }
        if Library.instruction(number: number, in: context) != nil {
            onFound(number)
        } else {
            status = "There is no instruction \(Labels.code(number))."
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

    // MARK: Item

    @ViewBuilder
    private var itemControls: some View {
        if prints.isEmpty {
            Text("No item has been taught yet. Open an instruction, and under “Recognise this item” take 2–3 photos of the item. Then point the camera at it here.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        } else {
            VStack(spacing: 12) {
                Button {
                    captureAndRecognize()
                } label: {
                    Label(recognizing ? "Looking…" : "Recognise", systemImage: "camera.viewfinder")
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(recognizing)

                Text(status.isEmpty ? "Hold the item in view, then tap Recognise." : status)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if !suggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Which one is it?").font(.headline)
                        ForEach(suggestions) { match in
                            suggestionRow(match)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    @ViewBuilder
    private func suggestionRow(_ match: Recognition.Match) -> some View {
        if let instruction = instructions.first(where: { $0.uid == match.instructionUID }) {
            Button {
                onFound(instruction.number)
            } label: {
                HStack(spacing: 12) {
                    Thumbnail(data: prints.first { $0.instructionUID == match.instructionUID }?.thumbData, size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Labels.code(instruction.number)).font(.subheadline.monospacedDigit().bold())
                        Text(instruction.title).font(.subheadline).lineLimit(2)
                    }
                    Spacer()
                    Text("\(match.similarity)%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(8)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
        }
    }

    /// A still from the live camera; without one (no scanner on this device),
    /// the system camera.
    private func captureAndRecognize() {
        guard let scanner = handle.scanner, scannerAvailable else {
            takingPhoto = true
            return
        }
        recognizing = true
        status = ""
        Task {
            do {
                let image = try await scanner.capturePhoto()
                recognize(image)
            } catch {
                recognizing = false
                status = "The camera could not take a picture: \(error.localizedDescription)"
            }
        }
    }

    private func recognize(_ image: UIImage) {
        recognizing = true
        suggestions = []
        let stored = prints.map { (instructionUID: $0.instructionUID, printData: $0.printData) }
        Task.detached(priority: .userInitiated) {
            let ranked: [Recognition.Match]
            do {
                let query = try Recognition.featurePrint(for: image)
                ranked = Recognition.rank(query, against: stored)
            } catch {
                await MainActor.run {
                    recognizing = false
                    status = error.localizedDescription
                }
                return
            }
            await MainActor.run {
                recognizing = false
                switch Recognition.verdict(for: ranked) {
                case .match(let uid):
                    if let number = instructions.first(where: { $0.uid == uid })?.number {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        onFound(number)
                    }
                case .unsure(let matches):
                    suggestions = matches
                    status = "Not sure — pick the right one below, or try again from another angle."
                case .none:
                    status = "Not recognised. Teach this item on its instruction, or scan its label."
                }
            }
        }
    }
}

/// Lets the Item mode take a still from the same live camera.
final class ScannerHandle {
    weak var scanner: DataScannerViewController?
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
    var handle: ScannerHandle?
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
        handle?.scanner = scanner
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

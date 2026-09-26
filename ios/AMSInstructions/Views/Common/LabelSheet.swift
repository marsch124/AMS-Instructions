import SwiftUI
import UIKit

/// Labels for one instruction or a whole filtered set: a preview, the tape or
/// roll size, and two ways out — AirPrint, or the share sheet for the
/// printer's own app (Brother iPrint&Label, DYMO Connect), which take PDFs
/// and pictures.
struct LabelSheet: View {
    let instructions: [Instruction]

    @Environment(LocalState.self) private var local
    @Environment(\.dismiss) private var dismiss
    @State private var files: [URL] = []
    @State private var preview: UIImage?

    /// Pictures as well as the PDF for a handful of labels; for a whole
    /// library the PDF alone, or the share sheet would carry hundreds of files.
    private let pictureLimit = 20

    var body: some View {
        @Bindable var local = local
        NavigationStack {
            Form {
                Section {
                    if let preview {
                        Image(uiImage: preview)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 140)
                            .frame(maxWidth: .infinity)
                            .padding(8)
                            .background(Color.white)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(.gray.opacity(0.4)))
                    }
                    Text(instructions.count == 1
                         ? Labels.code(instructions[0].number) + " — " + instructions[0].title
                         : "\(instructions.count) labels, one per page")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Picker("Tape / roll", selection: $local.labelSize) {
                        ForEach(LabelSize.allCases) { Text($0.name).tag($0) }
                    }
                } footer: {
                    Text("Choose the width of the tape or roll in your label printer. The QR code and the large AMS# number are what the scanner reads.")
                }

                Section {
                    Button {
                        sendToPrinter()
                    } label: {
                        Label("Print…", systemImage: "printer")
                    }
                    if !files.isEmpty {
                        ShareLink(items: files) {
                            Label("Send to the printer's app…", systemImage: "square.and.arrow.up")
                        }
                    }
                } footer: {
                    Text("Print… is for AirPrint printers. For Brother or DYMO printers, send the labels to their app instead.")
                }
            }
            .navigationTitle(instructions.count == 1 ? "Label" : "Labels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task(id: local.labelSize) { prepare() }
        }
    }

    private func prepare() {
        let size = local.labelSize
        preview = instructions.first
            .flatMap { Labels.png(for: $0, size: size) }
            .flatMap { UIImage(data: $0) }

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("labels", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        var urls: [URL] = []
        let pdfName = instructions.count == 1 ? Labels.code(instructions[0].number) : "AMS-labels"
        let pdfURL = folder.appendingPathComponent(pdfName.replacingOccurrences(of: "#", with: "-") + ".pdf")
        if (try? Labels.pdf(for: instructions, size: size).write(to: pdfURL)) != nil {
            urls.append(pdfURL)
        }
        if instructions.count <= pictureLimit {
            for instruction in instructions {
                let url = folder.appendingPathComponent(
                    Labels.code(instruction.number).replacingOccurrences(of: "#", with: "-") + ".png")
                if let data = Labels.png(for: instruction, size: size), (try? data.write(to: url)) != nil {
                    urls.append(url)
                }
            }
        }
        files = urls
    }

    private func sendToPrinter() {
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = instructions.count == 1 ? Labels.code(instructions[0].number) : "AMS labels"
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printingItem = Labels.pdf(for: instructions, size: local.labelSize)
        controller.present(animated: true)
    }
}

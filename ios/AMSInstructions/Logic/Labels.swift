import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

// Printed labels for the label printer: one label per page, black on white.
//
// A label carries the code twice — as a QR code holding "AMS#007" for the
// camera, and as large type for people. The "AMS#" prefix is what lets the
// scanner tell the label's number from any other number nearby (a fuse
// rating, "12V"), and the web app's scanner simply keeps the digits.
enum Labels {
    static func code(_ number: String) -> String {
        "AMS#" + Numbers.normalize(number)
    }

    static func pdf(for instructions: [Instruction], size: LabelSize) -> Data {
        let page = CGRect(origin: .zero, size: size.points)
        return UIGraphicsPDFRenderer(bounds: page).pdfData { context in
            for instruction in instructions {
                context.beginPage()
                draw(instruction, in: page, size: size, context: context.cgContext)
            }
        }
    }

    /// One image per label, at 300 dpi, for printer apps that take pictures
    /// rather than PDFs.
    static func png(for instruction: Instruction, size: LabelSize) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 300 / 72
        format.opaque = true
        let page = CGRect(origin: .zero, size: size.points)
        return UIGraphicsImageRenderer(size: size.points, format: format).image { context in
            UIColor.white.setFill()
            context.fill(page)
            draw(instruction, in: page, size: size, context: context.cgContext)
        }.pngData()
    }

    // MARK: Drawing

    private static func draw(_ instruction: Instruction, in page: CGRect, size: LabelSize, context: CGContext) {
        let margin = mm(size.marginMM)
        var area = page.insetBy(dx: margin, dy: margin)
        let codeText = Labels.code(instruction.number)

        if size.hasQR, let qr = qrImage(for: codeText) {
            let side = area.height
            context.interpolationQuality = .none
            UIImage(cgImage: qr).draw(in: CGRect(x: area.minX, y: area.minY, width: side, height: side))
            area.origin.x += side + mm(2)
            area.size.width -= side + mm(2)
        }

        let titleLines = size.titleLines
        let title = instruction.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let showTitle = titleLines > 0 && !title.isEmpty

        // The code takes most of the height; the title gets what is left.
        let codeHeight = showTitle ? area.height * 0.55 : area.height
        let codeFont = fittingFont(for: codeText, width: area.width, height: codeHeight)
        let codeSize = (codeText as NSString).size(withAttributes: [.font: codeFont])
        let codeY = showTitle ? area.minY : area.midY - codeSize.height / 2
        (codeText as NSString).draw(at: CGPoint(x: area.minX, y: codeY),
                                withAttributes: [.font: codeFont, .foregroundColor: UIColor.black])

        guard showTitle else { return }
        let titleTop = codeY + codeSize.height + mm(0.5)
        let titleRect = CGRect(x: area.minX, y: titleTop, width: area.width, height: area.maxY - titleTop)
        let titleFontSize = min(titleRect.height / (CGFloat(titleLines) * 1.2), codeFont.pointSize * 0.45)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        (title as NSString).draw(with: titleRect,
                                 options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                                 attributes: [.font: UIFont.systemFont(ofSize: max(titleFontSize, 5), weight: .medium),
                                              .foregroundColor: UIColor.black,
                                              .paragraphStyle: paragraph],
                                 context: nil)
    }

    /// The largest bold font the code fits into.
    private static func fittingFont(for text: String, width: CGFloat, height: CGFloat) -> UIFont {
        var size = height
        while size > 4 {
            let font = UIFont.monospacedDigitSystemFont(ofSize: size, weight: .heavy)
            let measured = (text as NSString).size(withAttributes: [.font: font])
            if measured.width <= width && measured.height <= height { return font }
            size -= 0.5
        }
        return UIFont.monospacedDigitSystemFont(ofSize: 4, weight: .heavy)
    }

    /// A crisp QR code: generated at one pixel per module, then enlarged by a
    /// whole factor so the modules stay sharp squares.
    private static func qrImage(for text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        return CIContext().createCGImage(scaled, from: scaled.extent)
    }

    static func mm(_ value: CGFloat) -> CGFloat { value * 72 / 25.4 }
}

/// The label formats offered. Tape is measured by its width (the label's
/// height); each label is cut to a sensible length.
enum LabelSize: String, CaseIterable, Identifiable {
    case tape12, tape24, tape36, roll62

    var id: String { rawValue }

    var name: String {
        switch self {
        case .tape12: return "12 mm tape"
        case .tape24: return "24 mm tape"
        case .tape36: return "36 mm tape"
        case .roll62: return "62 mm roll (62 × 29 mm)"
        }
    }

    /// Width × height in millimetres, as the label comes out of the printer.
    var sizeMM: CGSize {
        switch self {
        case .tape12: return CGSize(width: 40, height: 12)
        case .tape24: return CGSize(width: 60, height: 24)
        case .tape36: return CGSize(width: 80, height: 36)
        case .roll62: return CGSize(width: 62, height: 29)
        }
    }

    var points: CGSize {
        CGSize(width: Labels.mm(sizeMM.width), height: Labels.mm(sizeMM.height))
    }

    var marginMM: CGFloat { self == .tape12 ? 1 : 2 }

    /// A QR code on 12 mm tape would be too small to scan reliably.
    var hasQR: Bool { self != .tape12 }

    var titleLines: Int {
        switch self {
        case .tape12, .tape24: return 0
        case .tape36: return 1
        case .roll62: return 2
        }
    }
}

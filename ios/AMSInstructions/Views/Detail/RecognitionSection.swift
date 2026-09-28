import SwiftUI
import SwiftData
import UIKit

/// Teaching the app what this instruction's item looks like, so pointing the
/// camera at the item itself (Scan → Item) opens this instruction.
struct RecognitionSection: View {
    let instruction: Instruction

    @Environment(\.modelContext) private var context
    @Query private var prints: [RecognitionPrint]

    @State private var takingPhoto = false
    @State private var working = false
    @State private var problem: String?
    @State private var deleting: RecognitionPrint?

    init(instruction: Instruction) {
        self.instruction = instruction
        let uid = instruction.uid
        _prints = Query(filter: #Predicate<RecognitionPrint> { $0.instructionUID == uid },
                        sort: \.addedAt)
    }

    var body: some View {
        SectionCard(title: "Recognise this item", systemImage: "camera.viewfinder") {
            Text(prints.isEmpty
                 ? "Take 2–3 photos of the item this instruction is about — from the angles you would scan it. Then Scan → Item recognises it without a label."
                 : "Scan → Item opens this instruction when you point the camera at the item. More photos from other angles make it more reliable.")
                .font(.callout)
                .foregroundStyle(.secondary)

            if !prints.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(prints) { item in
                            // Touch and hold a photo to remove it.
                            Thumbnail(data: item.thumbData, size: 72)
                                .contextMenu {
                                    Button("Remove", role: .destructive) { deleting = item }
                                }
                        }
                    }
                }
            }

            if working {
                ProgressView("Learning the photo…")
            } else if prints.count < Recognition.maxPhotosPerInstruction {
                Button {
                    takingPhoto = true
                } label: {
                    Label(prints.isEmpty ? "Take Teaching Photo" : "Add Another Photo", systemImage: "camera")
                }
                .buttonStyle(.bordered)
            }

            if let problem {
                Text(problem).font(.caption).foregroundStyle(Palette.danger)
            }
        }
        .sheet(isPresented: $takingPhoto) {
            CameraPicker { image in
                takingPhoto = false
                if let image { learn(image) }
            }
            .ignoresSafeArea()
        }
        .confirmationDialog("Remove this teaching photo?",
                            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { item in
            Button("Remove", role: .destructive) {
                context.delete(item)
                try? context.save()
            }
        }
    }

    private func learn(_ image: UIImage) {
        working = true
        problem = nil
        let uid = instruction.uid
        Task.detached(priority: .userInitiated) {
            let result: Result<(Data, Data?), Error>
            do {
                let print = try Recognition.featurePrint(for: image)
                guard let data = Recognition.archive(print) else { throw Recognition.RecognitionError.noPrint }
                let thumb = image.jpegData(compressionQuality: 0.9).flatMap(PhotoProcessing.thumbnail(from:))
                result = .success((data, thumb))
            } catch {
                result = .failure(error)
            }
            await MainActor.run {
                working = false
                switch result {
                case .success(let (data, thumb)):
                    let stored = RecognitionPrint(instructionUID: uid)
                    stored.printData = data
                    stored.thumbData = thumb
                    context.insert(stored)
                    try? context.save()
                case .failure(let error):
                    problem = error.localizedDescription
                }
            }
        }
    }
}

/// The system camera, or the photo library where there is no camera.
struct CameraPicker: UIViewControllerRepresentable {
    let onDone: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onDone: onDone)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (UIImage?) -> Void

        init(onDone: @escaping (UIImage?) -> Void) {
            self.onDone = onDone
        }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onDone(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onDone(nil)
        }
    }
}

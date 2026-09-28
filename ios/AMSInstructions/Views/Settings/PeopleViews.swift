import SwiftUI
import SwiftData
import PhotosUI

struct PeopleView: View {
    @Query(sort: \Person.name) private var people: [Person]
    @State private var editing: PersonEditorTarget?

    var body: some View {
        let colors = OwnerColors(people: people)
        List {
            if people.isEmpty {
                Text("No people yet.").foregroundStyle(.secondary)
            }
            ForEach(people) { person in
                Button {
                    editing = PersonEditorTarget(person: person)
                } label: {
                    HStack(spacing: 12) {
                        PersonAvatar(name: person.name, colors: colors, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.name).foregroundStyle(.primary)
                            let contact = [person.phone, person.email].filter { !$0.isEmpty }.joined(separator: "  ·  ")
                            Text(contact.isEmpty ? "--" : contact)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("People")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editing = PersonEditorTarget(person: nil)
                } label: {
                    Label("Add", systemImage: "plus")
                        .labelStyle(.titleAndIcon)
                }
            }
        }
        .sheet(item: $editing) { target in
            PersonEditorView(person: target.person)
        }
    }
}

struct PersonEditorTarget: Identifiable {
    let id = UUID()
    let person: Person?
}

struct PersonEditorView: View {
    let person: Person?
    var onSaved: (Person) -> Void = { _ in }

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var handles = ""
    @State private var photo: Data?
    @State private var takingPhoto = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var loaded = false
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            Form {
                photoSection
                Section {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                    TextField("Phone", text: $phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                }
                Section {
                    TextField("Label|value", text: $handles, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .lineLimit(2...6)
                } header: {
                    Text("Other contacts")
                } footer: {
                    Text("One per line, e.g. Signal|+43 660 …")
                }
                if person != nil {
                    Section {
                        Button("Delete Person", role: .destructive) { confirmingDelete = true }
                    }
                }
            }
            .navigationTitle(person == nil ? "New Person" : "Edit Person")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .bold()
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear(perform: load)
            .sheet(isPresented: $takingPhoto) {
                CameraPicker { image in
                    takingPhoto = false
                    if let data = image?.jpegData(compressionQuality: 0.95) {
                        photo = PhotoProcessing.avatar(from: data) ?? photo
                    }
                }
                .ignoresSafeArea()
            }
            .onChange(of: pickerItem) { _, item in
                guard let item else { return }
                Task { @MainActor in
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        photo = PhotoProcessing.avatar(from: data) ?? photo
                    }
                    pickerItem = nil
                }
            }
            .confirmationDialog("Delete \"\(person?.name ?? "")\"?", isPresented: $confirmingDelete,
                                titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let person { context.delete(person) }
                    try? context.save()
                    dismiss()
                }
            } message: {
                Text("This does not remove them from past revision history.")
            }
        }
    }

    private var photoSection: some View {
        Section {
            HStack {
                Spacer()
                Group {
                    if let photo, let image = UIImage(data: photo) {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        ZStack {
                            Color(.tertiarySystemFill)
                            if name.trimmingCharacters(in: .whitespaces).isEmpty {
                                Image(systemName: "person.fill").font(.system(size: 40)).foregroundStyle(.secondary)
                            } else {
                                Text(OwnerColors.initials(of: name))
                                    .font(.system(size: 36, weight: .semibold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .frame(width: 96, height: 96)
                .clipShape(Circle())
                Spacer()
            }
            .listRowBackground(Color.clear)

            Button {
                takingPhoto = true
            } label: {
                Label("Take Photo", systemImage: "camera")
            }
            PhotosPicker(selection: $pickerItem, matching: .images) {
                Label("Choose from Library", systemImage: "photo.on.rectangle")
            }
            if photo != nil {
                Button(role: .destructive) {
                    photo = nil
                } label: {
                    Label("Remove Photo", systemImage: "trash")
                }
            }
        } footer: {
            Text("Shown next to the name throughout the app. Without a photo, the initials are shown.")
        }
    }

    private func load() {
        guard !loaded, let person else { return }
        loaded = true
        name = person.name
        photo = person.photoData
        phone = person.phone
        email = person.email
        handles = person.handles.map { "\($0.label)|\($0.value)" }.joined(separator: "\n")
    }

    private func save() {
        let target = person ?? {
            let created = Person(name: "")
            context.insert(created)
            return created
        }()
        target.name = name.trimmingCharacters(in: .whitespaces)
        target.phone = phone.trimmingCharacters(in: .whitespaces)
        target.email = email.trimmingCharacters(in: .whitespaces)
        target.photoData = photo
        target.handles = handles.split(separator: "\n").compactMap { line in
            let parts = line.split(separator: "|", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard let label = parts.first, !label.isEmpty else { return nil }
            return PersonHandle(label: label, value: parts.count > 1 ? parts[1] : "")
        }
        target.updatedAt = Date()
        try? context.save()
        onSaved(target)
        dismiss()
    }
}

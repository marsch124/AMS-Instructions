import SwiftUI
import SwiftData

struct PeopleView: View {
    @Query(sort: \Person.name) private var people: [Person]
    @State private var editing: PersonEditorTarget?

    var body: some View {
        List {
            if people.isEmpty {
                Text("No people yet.").foregroundStyle(.secondary)
            }
            ForEach(people) { person in
                Button {
                    editing = PersonEditorTarget(person: person)
                } label: {
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
        .navigationTitle("People")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editing = PersonEditorTarget(person: nil)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add person")
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
    @State private var loaded = false
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            Form {
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

    private func load() {
        guard !loaded, let person else { return }
        loaded = true
        name = person.name
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

import SwiftUI

/// Where the Anthropic API key for AI drafts is pasted, checked and removed.
struct AIKeyView: View {
    @State private var stored = APIKeyStore.hint
    @State private var entry = ""
    @State private var checking = false
    @State private var result: (ok: Bool, text: String)?

    var body: some View {
        Form {
            Section {
                Text("With a key, **Instructions → New → New from Photos** sends your photos to Claude, which drafts the whole instruction for you to check. Each draft costs a few cents, billed by Anthropic to your API account — separate from any Claude subscription.")
                    .font(.callout)
            }

            Section {
                if let stored {
                    LabeledContent("Saved key", value: stored)
                } else {
                    Text("No key saved yet.").foregroundStyle(.secondary)
                }
                SecureField("Paste the key here (sk-ant-…)", text: $entry)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(stored == nil ? "Save Key" : "Replace Key") { saveKey() }
                    .disabled(entry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || checking)
            } header: {
                Text("Your key")
            } footer: {
                Text("Kept in the iPhone's Keychain, never in backups. iCloud Keychain brings it to your other devices.")
            }

            if checking {
                Section { ProgressView("Checking the key with Anthropic…") }
            } else if let result {
                Section {
                    Label(result.text, systemImage: result.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(result.ok ? Palette.success : Palette.danger)
                }
            }

            if stored != nil {
                Section {
                    Button("Check Key") { check() }
                        .disabled(checking)
                    Button("Remove Key", role: .destructive) {
                        APIKeyStore.remove()
                        stored = nil
                        result = nil
                    }
                }
            }

            Section("Getting a key") {
                Text("1. Sign in at console.anthropic.com (or create an account).")
                Text("2. Add a payment method and a little credit, e.g. $5 — that covers many drafts.")
                Text("3. Create an API key, name it “AMS Instructions”, and copy it. It starts with sk-ant-.")
                Text("4. Paste it above and tap Save Key.")
                Link("Open console.anthropic.com", destination: URL(string: "https://console.anthropic.com")!)
            }
        }
        .navigationTitle("AI Drafts")
    }

    private func saveKey() {
        guard APIKeyStore.save(entry) else {
            result = (false, "The key could not be saved.")
            return
        }
        entry = ""
        stored = APIKeyStore.hint
        check()
    }

    private func check() {
        guard let key = APIKeyStore.key else { return }
        checking = true
        result = nil
        Task { @MainActor in
            do {
                try await AIDraft.check(key: key)
                result = (true, "The key works.")
            } catch {
                result = (false, error.localizedDescription)
            }
            checking = false
        }
    }
}

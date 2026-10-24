import SwiftUI

@main struct RuntimeFixtureApp: App {
    var body: some Scene { WindowGroup { RuntimeView() } }
}

/// Separate synthetic test App. No network, production data or system changes.
struct RuntimeView: View {
    @State private var status = UserDefaults.standard.bool(forKey: "loss")
        ? "Data lost" : (UserDefaults.standard.string(forKey: "saved") ?? "Ready")
    @State private var busy = false
    @State private var help = false
    @State private var pending: Task<Void, Never>?
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Mirror Runtime Fixture").font(.title)
            Text("Synthetic data only · no network")
            Text(status).accessibilityIdentifier("runtime.status")
            if busy { ProgressView("Observing synthetic transition…") }
            Button("Delayed success") { delay() }
                .accessibilityIdentifier("runtime.delay").disabled(busy)
            Button("Blink once") { blink() }
                .accessibilityIdentifier("runtime.blink").disabled(busy)
            Button("Save fixed value") { save(loss: false) }
                .accessibilityIdentifier("runtime.save")
            Button("Lose value on next restart") { save(loss: true) }
                .accessibilityIdentifier("runtime.loss")
            Button("Help") { help.toggle() }.accessibilityIdentifier("runtime.help")
            if help { Text("Only this App's synthetic Saved 1200 value is modified.") }
            Spacer()
        }.padding().onDisappear { pending?.cancel() }
    }
    @MainActor private func save(loss: Bool) {
        pending?.cancel(); busy = false
        UserDefaults.standard.set("Saved 1200", forKey: "saved")
        UserDefaults.standard.set(loss, forKey: "loss")
        status = "Saved 1200"
    }
    @MainActor private func delay() {
        guard !busy else { return }
        busy = true; status = "Pending"
        pending = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 5_000_000_000) }
            catch { return }
            status = "Complete"; busy = false
        }
    }
    @MainActor private func blink() {
        guard !busy else { return }
        busy = true; status = "Complete"
        pending = Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: 6_000_000_000)
                status = "Counterexample"
                try await Task.sleep(nanoseconds: 4_000_000_000)
                status = "Complete"; busy = false
            } catch { return }
        }
    }
}

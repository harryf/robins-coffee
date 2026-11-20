// ROBIN's Studio, the Mac shell: one window that shows the Studio's editing screen.
//
// It finds bun, starts the Studio server (src/studio/server.ts) for the repository folder
// this app was built for, waits until the server answers, and shows /_studio/ in a web
// view. Any other address opens in the default browser. The server stops when the app
// quits: the app ends the process, and the server also watches its standard input, which
// closes if the app dies in any other way.
//
// The repository folder is not in this source. scripts/build-app.ts writes it into the
// bundle's Info.plist (key StudioRepository) when it builds the app.
import AppKit
import Darwin
import WebKit

// The few words the shell itself can show, in English and German (Swiss spelling).
struct Words {
    let noFolderTitle: String
    let noFolderText: (String) -> String
    let noBunTitle: String
    let noBunText: String
    let noServerTitle: String
    let noServerText: (String) -> String
    let quit: String
    let edit: String
    let undo: String, redo: String, cut: String, copy: String, paste: String, selectAll: String
    let quitApp: String, hide: String, window: String, minimize: String, close: String, reload: String

    static let en = Words(
        noFolderTitle: "The site's folder is missing",
        noFolderText: { "The Studio was built for the folder\n\($0)\nbut it is not there, or it is not the site's repository. Put the folder back, or build the app again from where it is now:\n\nbun scripts/build-app.ts" },
        noBunTitle: "bun is not installed",
        noBunText: "The Studio needs bun to run. Install it in the Terminal with\n\ncurl -fsSL https://bun.sh/install | bash\n\nor with Homebrew:\n\nbrew install oven-sh/bun/bun\n\nThen open the Studio again.",
        noServerTitle: "The Studio could not start",
        noServerText: { "The local server did not answer. This is what it said:\n\n\($0)" },
        quit: "Quit",
        edit: "Edit",
        undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All",
        quitApp: "Quit ROBIN's Studio", hide: "Hide ROBIN's Studio", window: "Window", minimize: "Minimize", close: "Close", reload: "Reload"
    )
    static let de = Words(
        noFolderTitle: "Der Ordner der Website fehlt",
        noFolderText: { "Das Studio wurde für den Ordner\n\($0)\ngebaut, aber er ist nicht da oder er ist nicht das Repository der Website. Lege den Ordner zurück oder baue die App dort neu, wo er jetzt liegt:\n\nbun scripts/build-app.ts" },
        noBunTitle: "bun ist nicht installiert",
        noBunText: "Das Studio braucht bun. Installiere es im Terminal mit\n\ncurl -fsSL https://bun.sh/install | bash\n\noder mit Homebrew:\n\nbrew install oven-sh/bun/bun\n\nÖffne das Studio danach noch einmal.",
        noServerTitle: "Das Studio konnte nicht starten",
        noServerText: { "Der lokale Server hat nicht geantwortet. Das hat er gemeldet:\n\n\($0)" },
        quit: "Beenden",
        edit: "Bearbeiten",
        undo: "Widerrufen", redo: "Wiederholen", cut: "Ausschneiden", copy: "Kopieren", paste: "Einsetzen", selectAll: "Alles auswählen",
        quitApp: "ROBIN's Studio beenden", hide: "ROBIN's Studio ausblenden", window: "Fenster", minimize: "Im Dock ablegen", close: "Schliessen", reload: "Neu laden"
    )
    static var current: Words { (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("de") ? de : en }
}

/// bun, from the usual places first, then from the person's login shell.
func findBun() -> String? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    for path in ["\(home)/.bun/bin/bun", "/opt/homebrew/bin/bun", "/usr/local/bin/bun"] where FileManager.default.isExecutableFile(atPath: path) {
        return path
    }
    let shell = Process()
    shell.executableURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
    shell.arguments = ["-l", "-c", "command -v bun"]
    let out = Pipe()
    shell.standardOutput = out
    shell.standardError = FileHandle.nullDevice
    shell.standardInput = FileHandle.nullDevice
    guard (try? shell.run()) != nil else { return nil }
    shell.waitUntilExit()
    let found = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return shell.terminationStatus == 0 && FileManager.default.isExecutableFile(atPath: found) ? found : nil
}

/// A port on 127.0.0.1 that is free right now.
func freePort() -> Int? {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return nil }
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    guard bound == 0 else { return nil }
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) } }
    return named == 0 ? Int(UInt16(bigEndian: addr.sin_port)) : nil
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    let words = Words.current
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var lifeline: Pipe?
    var serverSaid = ""
    var origin = ""

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let repository = (Bundle.main.object(forInfoDictionaryKey: "StudioRepository") as? String) ?? ""
        guard !repository.isEmpty, FileManager.default.fileExists(atPath: "\(repository)/src/studio/server.ts") else {
            return stop(words.noFolderTitle, words.noFolderText(repository.isEmpty ? "?" : repository))
        }
        guard let bun = findBun() else { return stop(words.noBunTitle, words.noBunText) }
        guard let port = freePort() else { return stop(words.noServerTitle, words.noServerText("no free port")) }
        origin = "http://127.0.0.1:\(port)"

        let process = Process()
        process.executableURL = URL(fileURLWithPath: bun)
        process.arguments = ["src/studio/server.ts", "--port", String(port), "--lifeline"]
        process.currentDirectoryURL = URL(fileURLWithPath: repository)
        // git and friends must be found by the server; a login shell's PATH is not inherited by an app.
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\((bun as NSString).deletingLastPathComponent):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = env
        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = output
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let text = String(data: handle.availableData, encoding: .utf8) ?? ""
            DispatchQueue.main.async { self?.serverSaid = String(((self?.serverSaid ?? "") + text).suffix(2000)) }
        }
        do { try process.run() } catch { return stop(words.noServerTitle, words.noServerText(error.localizedDescription)) }
        server = process
        lifeline = input

        showWindow()
        waitForServer(until: Date().addingTimeInterval(40))
    }

    func showWindow() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "ROBIN's Studio"
        window.minSize = NSSize(width: 380, height: 480)
        // The night background from the site's tokens, written into the bundle by the build script.
        if let hex = Bundle.main.object(forInfoDictionaryKey: "StudioBackground") as? String, let rgb = UInt32(hex.dropFirst(), radix: 16), hex.count == 7 {
            window.backgroundColor = NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
        }
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("StudioWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Ask the server for the screen until it answers, the process ends or the time is up.
    func waitForServer(until deadline: Date) {
        guard let server = server else { return }
        if !server.isRunning { return stop(words.noServerTitle, words.noServerText(serverSaid)) }
        var request = URLRequest(url: URL(string: "\(origin)/_studio/")!)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    self.web.load(URLRequest(url: URL(string: "\(self.origin)/_studio/")!))
                } else if Date() > deadline {
                    self.stop(self.words.noServerTitle, self.words.noServerText(self.serverSaid))
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.waitForServer(until: deadline) }
                }
            }
        }.resume()
    }

    func stop(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = text
        alert.addButton(withTitle: words.quit)
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
    }

    func stopServer() {
        guard let server = server, server.isRunning else { return }
        try? lifeline?.fileHandleForWriting.close()
        server.terminate()
        let deadline = Date().addingTimeInterval(3)
        while server.isRunning && Date() < deadline { usleep(50_000) }
        if server.isRunning { kill(server.processIdentifier, SIGKILL) }
    }

    func applicationWillTerminate(_ note: Notification) { stopServer() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // The Studio's own pages stay in the window; every other address goes to the default browser.
    func isOwn(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        if url.scheme == "about" { return true }
        return "\(url.scheme ?? "")://\(url.host ?? ""):\(url.port ?? 80)" == origin && url.path.hasPrefix("/_studio")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if isOwn(action.request.url) { return decisionHandler(.allow) }
        if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    // A link that asks for a new window (target="_blank") opens in the default browser too.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    // File pickers: <input type="file"> in a form.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { answer in completionHandler(answer == .OK ? panel.urls : nil) }
    }

    @objc func reload(_ sender: Any?) { web?.reload() }

    func buildMenu() {
        let main = NSMenu()
        let app = NSMenu()
        app.addItem(withTitle: words.hide, action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(.separator())
        app.addItem(withTitle: words.quitApp, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appItem = NSMenuItem()
        appItem.submenu = app
        main.addItem(appItem)

        // Without an Edit menu, Cmd-V does nothing in a web view, and keys are pasted here.
        let edit = NSMenu(title: words.edit)
        edit.addItem(withTitle: words.undo, action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: words.redo, action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: words.cut, action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: words.copy, action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: words.paste, action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: words.selectAll, action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem()
        editItem.submenu = edit
        main.addItem(editItem)

        let win = NSMenu(title: words.window)
        win.addItem(withTitle: words.reload, action: #selector(reload(_:)), keyEquivalent: "r")
        win.addItem(withTitle: words.minimize, action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: words.close, action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let winItem = NSMenuItem()
        winItem.submenu = win
        main.addItem(winItem)
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
// Ending the app from outside (kill, log out) must end the server too.
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT, SIGHUP] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { NSApp.terminate(nil) }
    source.resume()
    signalSources.append(source)
}
app.run()

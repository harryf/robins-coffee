// Translates short texts with Apple's Translation framework, on this Mac only: a language
// pack that is not installed is never downloaded, and nothing goes to the network.
// Reads one JSON object on standard input (never text on the command line):
//   {"source": "en", "targets": ["de", "fr", "it"], "texts": ["A cup of coffee."]}
// and prints one JSON object with the source language and one entry per target language:
//   {"source": "en", "results": {"de": {"status": "ok", "texts": ["Eine Tasse Kaffee."]}, "fr": {"status": "missing"}}}
// status is "ok" (the pack is installed; texts holds one translation per input text, in
// order), "missing" (the system knows the pair but its pack is not on this Mac),
// "unsupported" (the system cannot translate that pair at all), "old_mac" (macOS older
// than 26) or "failed" (with "error"). With no texts it only says which packs are there.
// A source of "auto" means the texts' language is not known: Apple's NaturalLanguage
// framework recognises it on this Mac first, and "source" in the answer names it.
// Built and run by src/translate.ts:
//   swiftc -O tools/translate.swift -o .cache/translate && .cache/translate < request.json
import Foundation
import NaturalLanguage
import Translation

struct Ask: Decodable {
  let source: String
  let targets: [String]
  let texts: [String]
}

func fail(_ why: String) -> Never {
  FileHandle.standardError.write("\(why)\n".data(using: .utf8)!)
  exit(2)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let ask = try? JSONDecoder().decode(Ask.self, from: input) else { fail("usage: translate < {\"source\": \"en\", \"targets\": [\"de\"], \"texts\": [\"...\"]}") }

var sourceCode = ask.source
if sourceCode == "auto" {
  let recognizer = NLLanguageRecognizer()
  recognizer.processString(ask.texts.joined(separator: "\n"))
  sourceCode = recognizer.dominantLanguage?.rawValue ?? "und"
}

var results: [String: [String: Any]] = [:]
if #available(macOS 26.0, *) {
  let source = Locale.Language(identifier: sourceCode)
  let availability = LanguageAvailability()
  for code in ask.targets where code != sourceCode {
    let target = Locale.Language(identifier: code)
    switch await availability.status(from: source, to: target) {
    case .unsupported:
      results[code] = ["status": "unsupported"]
    case .supported:
      results[code] = ["status": "missing"]
    case .installed:
      if ask.texts.isEmpty { results[code] = ["status": "ok", "texts": [String]()]; continue }
      do {
        let session = TranslationSession(installedSource: source, target: target)
        let requests = ask.texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
        var texts = ask.texts.map { _ in "" }
        for response in try await session.translations(from: requests) {
          if let at = Int(response.clientIdentifier ?? ""), at >= 0, at < texts.count { texts[at] = response.targetText }
        }
        results[code] = ["status": "ok", "texts": texts]
      } catch {
        results[code] = ["status": "failed", "error": error.localizedDescription]
      }
    @unknown default:
      results[code] = ["status": "unsupported"]
    }
  }
} else {
  for code in ask.targets where code != sourceCode { results[code] = ["status": "old_mac"] }
}
let data = try JSONSerialization.data(withJSONObject: ["source": sourceCode, "results": results], options: [.sortedKeys])
FileHandle.standardOutput.write(data)

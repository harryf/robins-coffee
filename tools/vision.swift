// Looks at one picture with Apple's Vision framework and prints what it found as JSON:
// where the eye goes (a focus point for cropping), what is in it (labels), any text it
// can read, and how many faces. Nothing leaves the Mac. Built and run by src/vision.ts:
//   swiftc -O tools/vision.swift -o .cache/vision && .cache/vision <picture>
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write("usage: vision <picture>\n".data(using: .utf8)!)
  exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let handler = VNImageRequestHandler(url: url, options: [:])
let saliency = VNGenerateAttentionBasedSaliencyImageRequest()
let classify = VNClassifyImageRequest()
let text = VNRecognizeTextRequest()
text.recognitionLevel = .accurate
text.recognitionLanguages = ["en-US", "de-DE"]
let faces = VNDetectFaceRectanglesRequest()

do {
  try handler.perform([saliency, classify, text, faces])
} catch {
  FileHandle.standardError.write("could not read the picture: \(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}

// Vision measures from the bottom left; the web measures from the top left.
var out: [String: Any] = [:]
if let boxes = (saliency.results?.first as? VNSaliencyImageObservation)?.salientObjects, !boxes.isEmpty {
  let all = boxes.map { $0.boundingBox }.reduce(CGRect.null) { $0.union($1) }
  out["focus"] = ["x": Double(all.midX), "y": Double(1 - all.midY)]
  out["box"] = ["x": Double(all.minX), "y": Double(1 - all.maxY), "w": Double(all.width), "h": Double(all.height)]
}
out["labels"] = (classify.results ?? [])
  .filter { $0.confidence >= 0.3 }
  .prefix(12)
  .map { ["name": $0.identifier, "confidence": Double($0.confidence)] as [String: Any] }
out["text"] = (text.results ?? []).compactMap { $0.topCandidates(1).first }.filter { $0.confidence >= 0.5 }.map { $0.string }
out["faces"] = (faces.results ?? []).map { f -> [String: Double] in
  let b = f.boundingBox
  return ["x": Double(b.minX), "y": Double(1 - b.maxY), "w": Double(b.width), "h": Double(b.height)]
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
FileHandle.standardOutput.write(data)

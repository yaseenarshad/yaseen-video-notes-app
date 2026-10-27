// Labs experiment "slides": the text on each slide image, read by macOS Vision (VNRecognizeTextRequest, accurate).
// Compiled once by ocr.ts into Labs' userData (labs-tools/slides-ocr-<hash>); run as `slides-ocr <image>…`.
// Prints one JSON line per image: {"file": "...", "lines": [{"text": "...", "conf": 0.98, "x": 0.1, "y": 0.05, "h": 0.04}]}
// (x, y = top-left of the line's box, 0–1 from the image's top-left; h = its height). Errors: {"file": "...", "error": "..."}.
import Foundation
import Vision
import ImageIO

func readText(_ path: String) -> [String: Any] {
  let url = URL(fileURLWithPath: path)
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    return ["file": path, "error": "could not read the image"]
  }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  req.recognitionLanguages = ["en-US"]
  let handler = VNImageRequestHandler(cgImage: img, options: [:])
  do { try handler.perform([req]) } catch { return ["file": path, "error": "\(error)"] }
  var lines: [[String: Any]] = []
  for o in req.results ?? [] {
    guard let c = o.topCandidates(1).first else { continue }
    let b = o.boundingBox
    lines.append(["text": c.string, "conf": Double(c.confidence), "x": Double(b.minX), "y": Double(1 - b.maxY), "h": Double(b.height)])
  }
  return ["file": path, "lines": lines]
}

for path in CommandLine.arguments.dropFirst() {
  let out = readText(path)
  if let data = try? JSONSerialization.data(withJSONObject: out), let s = String(data: data, encoding: .utf8) {
    print(s)
    fflush(stdout)
  }
}

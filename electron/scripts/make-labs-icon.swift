// USAGE: swift scripts/make-labs-icon.swift <in.iconset> <out.iconset>
// Makes the Labs app icon: every PNG of the normal app's iconset with its hue turned (orange → blue) and a
// little more saturation, so the Labs app is easy to tell apart in the Dock and in /Applications.
// Run by hand when build/icon.icns changes (see docs/labs.md):
//   iconutil -c iconset build/icon.icns -o /tmp/vn.iconset
//   swift scripts/make-labs-icon.swift /tmp/vn.iconset /tmp/vn-labs.iconset
//   iconutil -c icns /tmp/vn-labs.iconset -o build/icon-labs.icns
import AppKit
import CoreImage

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: make-labs-icon.swift <in.iconset> <out.iconset>"); exit(2) }
let inDir = URL(fileURLWithPath: args[1]), outDir = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let ctx = CIContext()
for name in try FileManager.default.contentsOfDirectory(atPath: inDir.path) where name.hasSuffix(".png") {
  guard let img = CIImage(contentsOf: inDir.appendingPathComponent(name)) else { continue }
  let hue = CIFilter(name: "CIHueAdjust")!
  hue.setValue(img, forKey: kCIInputImageKey)
  hue.setValue(-2.2, forKey: kCIInputAngleKey) // radians: orange → blue
  let sat = CIFilter(name: "CIColorControls")!
  sat.setValue(hue.outputImage!, forKey: kCIInputImageKey)
  sat.setValue(1.15, forKey: kCIInputSaturationKey)
  guard let out = sat.outputImage, let cg = ctx.createCGImage(out, from: img.extent) else { continue }
  let rep = NSBitmapImageRep(cgImage: cg)
  try rep.representation(using: .png, properties: [:])!.write(to: outDir.appendingPathComponent(name))
  print("tinted \(name)")
}

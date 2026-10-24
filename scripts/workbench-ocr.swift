import Foundation
import Vision
import ImageIO

// stdin contains image data, never paths, commands or URLs. No networking or device APIs.
let helperVersion = "1"
#if arch(arm64)
let architecture = "arm64"
#else
let architecture = "x64"
#endif
let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
func emit(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard data.count <= 262144 else { throw NSError(domain: "ocr-output-budget", code: 1) }
    FileHandle.standardOutput.write(data)
}
func capabilities() throws -> [[String: Any]] {
    try VNRecognizeTextRequest.supportedRevisions.map { revision in
        let request = VNRecognizeTextRequest()
        request.revision = revision
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        return ["revision": revision, "languages": try request.supportedRecognitionLanguages()]
    }
}
do {
    if CommandLine.arguments == [CommandLine.arguments[0], "--doctor"] {
        try emit(["contractVersion": 1, "helperVersion": helperVersion, "osVersion": osVersion, "arch": architecture, "revisions": try capabilities()])
    } else {
        guard CommandLine.arguments.count == 1 else { throw NSError(domain: "ocr-arguments", code: 1) }
        var input = Data()
        while let chunk = try FileHandle.standardInput.read(upToCount: 65536), !chunk.isEmpty {
            input.append(chunk)
            guard input.count <= 5800000 else { throw NSError(domain: "ocr-input-budget", code: 1) }
        }
        guard let requestInput = try JSONSerialization.jsonObject(with: input) as? [String: Any],
              Set(requestInput.keys) == Set(["contractVersion", "png", "revision", "languages"]),
              requestInput["contractVersion"] as? Int == 1,
              let revision = requestInput["revision"] as? Int, VNRecognizeTextRequest.supportedRevisions.contains(revision),
              let languages = requestInput["languages"] as? [String], !languages.isEmpty, languages.count <= 4,
              let base64 = requestInput["png"] as? String, let png = Data(base64Encoded: base64), png.count <= 4194304,
              png.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]),
              let source = CGImageSourceCreateWithData(png as CFData, nil), CGImageSourceGetCount(source) == 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 4096, height <= 4096,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "ocr-invalid-request", code: 1) }
        let request = VNRecognizeTextRequest()
        request.revision = revision
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.automaticallyDetectsLanguage = false
        let supported = try request.supportedRecognitionLanguages()
        guard Set(languages).count == languages.count, languages.allSatisfy({ supported.contains($0) }) else { throw NSError(domain: "ocr-language", code: 1) }
        request.recognitionLanguages = languages
        try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
        let observations = request.results ?? []
        guard observations.count <= 256 else { throw NSError(domain: "ocr-output-budget", code: 1) }
        let boxes: [[String: Any]] = try observations.map { observation in
            guard let candidate = observation.topCandidates(1).first, candidate.string.count <= 4096 else { throw NSError(domain: "ocr-invalid-candidate", code: 1) }
            let rect = observation.boundingBox
            return ["text": candidate.string, "confidence": candidate.confidence, "box": ["x": max(0, rect.minX), "y": max(0, 1 - rect.maxY), "width": rect.width, "height": rect.height]]
        }
        try emit(["contractVersion": 1, "helperVersion": helperVersion, "osVersion": osVersion, "arch": architecture, "requestRevision": revision, "languages": languages, "boxes": boxes])
    }
} catch {
    // Never echo untrusted image text, compiler paths or Vision error details.
    FileHandle.standardError.write(Data("ocr-helper-failed\n".utf8))
    exit(2)
}

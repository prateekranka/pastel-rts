import Foundation

enum NativeInboundType: String {
    case gameReady
    case requestHaptic
    case performanceReport
    case runtimeError
}

enum NativeOutboundType: String {
    case pause
    case resume
    case setDeveloperConfiguration
}

struct NativeInboundMessage {
    let type: NativeInboundType
    let payload: [String: Any]

    static func parse(_ body: Any) throws -> NativeInboundMessage {
        guard let dict = body as? [String: Any], let raw = dict["type"] as? String else {
            throw BridgeError.malformed("Message must be an object with a type")
        }
        guard let type = NativeInboundType(rawValue: raw) else {
            throw BridgeError.malformed("Unknown JS→native type: \(raw)")
        }
        guard let payload = dict["payload"] as? [String: Any] else {
            throw BridgeError.malformed("payload is required")
        }
        switch type {
        case .gameReady:
            guard payload["renderer"] is String,
                  let viewport = payload["viewport"] as? [String: Any],
                  viewport["width"] is NSNumber,
                  viewport["height"] is NSNumber
            else {
                throw BridgeError.malformed("gameReady payload is malformed")
            }
        case .requestHaptic:
            guard let style = payload["style"] as? String,
                  ["light", "medium", "heavy"].contains(style)
            else {
                throw BridgeError.malformed("requestHaptic payload is malformed")
            }
            if let reason = payload["reason"] as? String {
                let allowed = ["selection", "move", "place", "invalid"]
                if !allowed.contains(reason) {
                    throw BridgeError.malformed("requestHaptic reason is malformed")
                }
            }
        case .performanceReport:
            break
        case .runtimeError:
            guard payload["message"] is String else {
                throw BridgeError.malformed("runtimeError payload is malformed")
            }
        }
        return NativeInboundMessage(type: type, payload: payload)
    }
}

enum BridgeError: LocalizedError {
    case malformed(String)

    var errorDescription: String? {
        switch self {
        case .malformed(let message):
            return message
        }
    }
}

enum NativeOutbound {
    static func pauseJSON() -> String {
        #"{"type":"pause"}"#
    }

    static func resumeJSON() -> String {
        #"{"type":"resume"}"#
    }

    static func developerConfiguration(haptics: Bool, renderer: String) -> String {
        let payload = #"{"haptics":\#(haptics ? "true" : "false"),"renderer":"\#(renderer)"}"#
        return #"{"type":"setDeveloperConfiguration","payload":\#(payload)}"#
    }
}

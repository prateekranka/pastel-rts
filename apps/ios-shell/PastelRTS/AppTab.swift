import SwiftUI

enum AppTab: String, Hashable {
    case game
    case studio
}

extension Notification.Name {
    static let pastelScenePhase = Notification.Name("pastelScenePhase")
    static let pastelSelectedTab = Notification.Name("pastelSelectedTab")
}

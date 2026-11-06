#if HAPI_XCODE26_COMPAT
import SwiftUI
import UIKit

/// Local-only shims so the app can be built with Xcode 26 for iOS 26 devices.
/// The real symbols exist in the iOS 27 SDK; this file is excluded from
/// normal builds (the `HAPI_XCODE26_COMPAT` flag is only passed on the
/// personal-signing build command).
final class UIHingeInteraction: NSObject, UIInteraction {
    struct Update {
        var hinge: AnyObject?
    }

    weak var view: UIView?
    private let handler: (UIHingeInteraction, Update) -> Void

    init(_ handler: @escaping (UIHingeInteraction, Update) -> Void) {
        self.handler = handler
        super.init()
    }

    func willMove(to view: UIView?) {
        self.view = view
    }

    func didMove(to view: UIView?) {}
}

enum HapiToolbarMinimizationBehavior {
    case onScrollDown
}

enum HapiToolbarMinimizationRestoration {
    case atScrollEdge
}

enum HapiToolbarMinimizationSafeAreaAdjustment {
    case enabled
}

enum HapiToolbarMinimizationPlacement {
    case navigationBar
}

extension View {
    func toolbarMinimizationBehavior(
        _ behavior: HapiToolbarMinimizationBehavior,
        for placement: HapiToolbarMinimizationPlacement
    ) -> some View {
        self
    }

    func toolbarMinimizationRestoration(
        _ restoration: HapiToolbarMinimizationRestoration,
        for placement: HapiToolbarMinimizationPlacement
    ) -> some View {
        self
    }

    func toolbarMinimizationSafeAreaAdjustment(
        _ adjustment: HapiToolbarMinimizationSafeAreaAdjustment,
        for placement: HapiToolbarMinimizationPlacement
    ) -> some View {
        self
    }
}
#endif

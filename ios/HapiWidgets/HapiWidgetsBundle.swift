import SwiftUI
import WidgetKit

@main
struct HapiWidgetsBundle: WidgetBundle {
    var body: some Widget {
        HapiHomeWidget()
        HapiRunningWidget()
        HapiReviewWidget()
        HapiFocusWidget()
        SessionLiveActivityWidget()
    }
}

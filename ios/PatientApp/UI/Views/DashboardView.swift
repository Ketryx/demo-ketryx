```swift
import SwiftUI
import Charts

struct DashboardView: View {
    @State private var glucoseLevels: [GlucoseLevel] = GlucoseLevel.sampleData
    @State private var insulinDoses: [InsulinDose] = InsulinDose.sampleData
    @State private var alarms: [Alarm] = Alarm.sampleData
    @State private var currentGlucose: GlucoseLevel? = GlucoseLevel.sampleData.last
    @Environment(\.dynamicTypeSize) var dynamicTypeSize

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    CurrentGlucoseView(glucose: currentGlucose)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Current glucose level")
                        .accessibilityValue(currentGlucose?.accessibilityDescription ?? "No data")
                        .padding(.top)

                    HStack(spacing: 16) {
                        QuickActionButton(
                            systemName: "drop.fill",
                            label: "Bolus",
                            action: { /* TODO: Implement bolus action */ }
                        )
                        QuickActionButton(
                            systemName: "clock.fill",
                            label: "Set Reminder",
                            action: { /* TODO: Implement reminder action */ }
                        )
                        QuickActionButton(
                            systemName: "gearshape.fill",
                            label: "Settings",
                            action: { /* TODO: Implement settings action */ }
                        )
                    }
                    .padding(.horizontal)
                    .accessibilityElement(children: .contain)

                    ChartCard(title: "Glucose Levels (Last 6 Hours)") {
                        Chart {
                            ForEach(glucoseLevels) { level in
                                LineMark(
                                    x: .value("Time", level.timestamp),
                                    y: .value("Glucose", level.mgDl)
                                )
                                .interpolationMethod(.catmullRom)
                            }
                        }
                        .chartYScale(domain: 40...250)
                        .frame(height: 180)
                        .accessibilityLabel("Glucose levels line chart for the last 6 hours")
                    }

                    ChartCard(title: "Insulin Delivery (Last 24 Hours)") {
                        Chart {
                            ForEach(insulinDoses) { dose in
                                BarMark(
                                    x: .value("Time", dose.timestamp),
                                    y: .value("Units", dose.units)
                                )
                            }
                        }
                        .frame(height: 140)
                        .accessibilityLabel("Bar chart showing recent insulin doses")
                    }

                    RecentInsulinDosesView(doses: insulinDoses)
                        .accessibilityElement(children: .contain)

                    UpcomingAlarmsView(alarms: alarms)
                        .accessibilityElement(children: .contain)

                    Spacer(minLength: 30)
                }
                .padding(.bottom, 20)
                .padding(.horizontal)
                .navigationTitle("Dashboard")
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }
}

private struct CurrentGlucoseView: View {
    let glucose: GlucoseLevel?

    var trendSymbol: Image? {
        guard let trend = glucose?.trend else { return nil }
        switch trend {
        case .rising: return Image(systemName: "arrow.up")
        case .falling: return Image(systemName: "arrow.down")
        case .steady: return Image(systemName: "minus")
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let glucose = glucose {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(glucose.mgDl)")
                        .font(.system(size: 72, weight: .bold))
                        .foregroundColor(glucose.color)
                        .minimumScaleFactor(0.5)
                        .accessibilityLabel("Current glucose")
                        .accessibilityValue("\(glucose.mgDl) milligrams per deciliter")
                    HStack(spacing: 4) {
                        trendSymbol?
                            .foregroundColor(glucose.color)
                            .imageScale(.large)
                        Text(glucose.trendDescription)
                            .font(.headline)
                            .foregroundColor(.secondary)
                    }
                    .accessibilityHidden(true)
                }
                Spacer()
            } else {
                Text("No glucose data")
                    .font(.title2)
                    .foregroundColor(.secondary)
                    .accessibilityLabel("No glucose data available")
                Spacer()
            }
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemGray6)))
        .accessibilityElement(children: .combine)
    }
}

private struct QuickActionButton: View {
    let systemName: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack {
                Image(systemName: systemName)
                    .font(.title2)
                    .frame(width: 44, height: 44)
                    .background(Color.accentColor.opacity(0.15))
                    .clipShape(Circle())
                Text(label)
                    .font(.footnote)
            }
            .foregroundColor(.accentColor)
            .accessibilityLabel(label)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

private struct ChartCard<Content: View>: View {
    let title: String
    let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
                .padding(.horizontal, 8)
            content()
                .padding(.horizontal, 8)
        }
        .padding(.vertical)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemBackground)).shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1))
        )
        .accessibilityElement(children: .contain)
    }
}

private struct RecentInsulinDosesView: View {
    let doses: [InsulinDose]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Recent Insulin Doses")
                .font(.headline)
            if doses.isEmpty {
                Text("No recent insulin doses.")
                    .foregroundColor(.secondary)
                    .accessibilityLabel("No recent insulin doses")
            } else {
                ForEach(doses.prefix(5)) { dose in
                    HStack {
                        Text(dose.timestamp, style: .time)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text("\(dose.units, specifier: "%.1f") U")
                            .font(.subheadline)
                            .bold()
                            .foregroundColor(.accentColor)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(dose.units, specifier: "%.1f") units at \(dose.timestamp.formatted(date: .omitted, time: .shortened))")
                }
            }
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemGray6)))
    }
}

private struct UpcomingAlarmsView: View {
    let alarms: [Alarm]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Upcoming Alarms & Reminders")
                .font(.headline)
            if alarms.isEmpty {
                Text("No upcoming alarms.")
                    .foregroundColor(.secondary)
                    .accessibilityLabel("No upcoming alarms or reminders")
            } else {
                ForEach(alarms.filter { $0.isUpcoming }) { alarm in
                    HStack {
                        Image(systemName: alarm.iconName)
                            .foregroundColor(.accentColor)
                        Text(alarm.title)
                        Spacer()
                        Text(alarm.timestamp, style: .time)
                            .foregroundColor(.secondary)
                            .font(.subheadline)
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(alarm.title), at \(alarm.timestamp.formatted(date: .omitted, time: .shortened))")
                }
            }
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemGray6)))
    }
}

// MARK: - Models

private struct GlucoseLevel: Identifiable {
    let id = UUID()
    let timestamp: Date
    let mgDl: Int
    let trend: GlucoseTrend

    var color: Color {
        switch mgDl {
        case ..<70: return .red
        case 70...180: return .green
        default: return .orange
        }
    }

    var trendDescription: String {
        switch trend {
        case .rising: return "Rising"
        case .falling: return "Falling"
        case .steady: return "Steady"
        }
    }

    var accessibilityDescription: String {
        "\(mgDl) milligrams per deciliter, \(trendDescription.lowercased())"
    }

    static var sampleData: [GlucoseLevel] {
        let now = Date()
        let values = [
            (mgDl: 90, trend: GlucoseTrend.steady),
            (mgDl: 95, trend: .rising),
            (mgDl: 110, trend: .rising),
            (mgDl: 130, trend: .rising),
            (mgDl: 145, trend: .falling),
            (mgDl: 140, trend: .steady),
            (mgDl: 135, trend: .falling)
        ]
        return values.enumerated().map { offset, element in
            GlucoseLevel(timestamp: now.addingTimeInterval(TimeInterval(-offset * 3600)), mgDl: element.mgDl, trend: element.trend)
        }.reversed()
    }
}

private enum GlucoseTrend {
    case rising, falling, steady
}

private struct InsulinDose: Identifiable {
    let id = UUID()
    let timestamp: Date
    let units: Double

    static var sampleData: [InsulinDose] {
        let now = Date()
        return [
            InsulinDose(timestamp: now.addingTimeInterval(-3600 * 1.5), units: 2.0),
            InsulinDose(timestamp: now.addingTimeInterval(-3600 * 3), units: 1.5),
            InsulinDose(timestamp: now.addingTimeInterval(-3600 * 6), units: 3.0),
            InsulinDose(timestamp: now.addingTimeInterval(-3600 * 12), units: 1.0),
            InsulinDose(timestamp: now.addingTimeInterval(-3600 * 18), units: 2.5),
        ]
    }
}

private struct Alarm: Identifiable {
    let id = UUID()
    let title: String
    let timestamp: Date
    let iconName: String

    var isUpcoming: Bool {
        timestamp > Date()
    }

    static var sampleData: [Alarm] {
        let now = Date()
        return [
            Alarm(title: "Take Insulin", timestamp: now.addingTimeInterval(3600 * 2), iconName: "drop.fill"),
            Alarm(title: "Check Glucose", timestamp: now.addingTimeInterval(3600 * 5), iconName: "waveform.path.ecg"),
            Alarm(title: "Meal Reminder", timestamp: now.addingTimeInterval(-3600), iconName: "fork.knife"),
        ]
    }
}

// MARK: - Preview

struct DashboardView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            DashboardView()
                .previewDevice("iPhone 14 Pro")
            DashboardView()
                .previewDevice("iPhone SE (3rd generation)")
                .environment(\.dynamicTypeSize, .accessibilityExtraExtraExtraLarge)
        }
    }
}
```
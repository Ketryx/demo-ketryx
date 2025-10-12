```swift
import SwiftUI

struct Blockage: Identifiable, Equatable {
    enum Severity: Int, CaseIterable {
        case mild = 0, moderate, severe, critical
        
        var color: Color {
            switch self {
            case .mild: return Color.green
            case .moderate: return Color.yellow
            case .severe: return Color.orange
            case .critical: return Color.red
            }
        }
        
        var description: String {
            switch self {
            case .mild: return "Mild"
            case .moderate: return "Moderate"
            case .severe: return "Severe"
            case .critical: return "Critical"
            }
        }
    }
    
    let id: UUID
    let name: String
    let severity: Severity
    let position: CGPoint  // normalized coordinates (0...1) on 3D model projection
    
    init(id: UUID = UUID(), name: String, severity: Severity, position: CGPoint) {
        self.id = id
        self.name = name
        self.severity = severity
        self.position = position
    }
}

struct BlockageOverlayView: View {
    let blockages: [Blockage]
    
    @State private var selectedBlockage: Blockage? = nil
    @Namespace private var animationNamespace
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        GeometryReader { geo in
            ZStack {
                // Overlay blockage markers
                ForEach(blockages) { blockage in
                    marker(for: blockage, in: geo.size)
                        .accessibilityElement()
                        .accessibilityLabel("\(blockage.name), severity \(blockage.severity.description)")
                        .accessibilityAddTraits(selectedBlockage == blockage ? [.isSelected, .isButton] : .isButton)
                        .onTapGesture {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                                if selectedBlockage == blockage {
                                    selectedBlockage = nil
                                } else {
                                    selectedBlockage = blockage
                                }
                            }
                        }
                }
                
                // Tooltip popover
                if let selected = selectedBlockage {
                    tooltipView(for: selected)
                        .frame(maxWidth: 250)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(colorScheme == .dark ? Color(.systemGray6) : Color(.white))
                                .shadow(color: Color.black.opacity(0.25), radius: 10, x: 0, y: 4)
                        )
                        .padding(16)
                        .transition(.opacity.combined(with: .scale))
                        .position(tooltipPosition(for: selected, in: geo.size))
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isModal)
                }
                
                // Legend bottom
                VStack {
                    Spacer()
                    legendView()
                        .padding(.bottom, 24)
                        .padding(.horizontal, 16)
                }
            }
            .contentShape(Rectangle()) // to detect taps outside markers
            .onTapGesture {
                if selectedBlockage != nil {
                    withAnimation(.easeOut(duration: 0.3)) {
                        selectedBlockage = nil
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityHint("Tap on blockage markers to view details")
    }
    
    @ViewBuilder
    private func marker(for blockage: Blockage, in size: CGSize) -> some View {
        let pos = CGPoint(x: blockage.position.x * size.width, y: blockage.position.y * size.height)
        Circle()
            .fill(blockage.severity.color)
            .frame(width: selectedBlockage == blockage ? 24 : 16,
                   height: selectedBlockage == blockage ? 24 : 16)
            .scaleEffect(selectedBlockage == blockage ? 1.3 : 1)
            .shadow(color: blockage.severity.color.opacity(0.7), radius: selectedBlockage == blockage ? 12 : 4)
            .overlay(
                Circle()
                    .strokeBorder(strokeColor(for: blockage.severity), lineWidth: selectedBlockage == blockage ? 3 : 1.5)
            )
            .position(pos)
            .animation(.spring(response: 0.35, dampingFraction: 0.7), value: selectedBlockage)
            .accessibilityAddTraits(.isButton)
    }
    
    @ViewBuilder
    private func tooltipView(for blockage: Blockage) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(blockage.name)
                .font(.headline)
                .foregroundColor(.primary)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                Circle()
                    .fill(blockage.severity.color)
                    .frame(width: 14, height: 14)
                Text("Severity: \(blockage.severity.description)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding(12)
    }
    
    @ViewBuilder
    private func legendView() -> some View {
        HStack(spacing: 16) {
            ForEach(Blockage.Severity.allCases.sorted(by: { $0.rawValue < $1.rawValue }), id: \.self) { severity in
                HStack(spacing: 6) {
                    Circle()
                        .fill(severity.color)
                        .frame(width: 14, height: 14)
                        .accessibilityHidden(true)
                    Text(severity.description)
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Severity level: \(severity.description)")
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(colorScheme == .dark ? Color(.systemGray5).opacity(0.2) : Color(.systemGray6).opacity(0.6))
        )
    }
    
    private func strokeColor(for severity: Blockage.Severity) -> Color {
        colorScheme == .dark ? Color.white.opacity(0.6) : Color.black.opacity(0.35)
    }
    
    private func tooltipPosition(for blockage: Blockage, in size: CGSize) -> CGPoint {
        // Try to place above marker; if too close to top, place below
        let baseX = blockage.position.x * size.width
        let baseY = blockage.position.y * size.height
        let offsetY: CGFloat = -60
        
        var proposedY = baseY + offsetY
        if proposedY < 80 {
            proposedY = baseY + 60
        }
        var proposedX = baseX
        // Keep tooltip within horizontal bounds with some padding
        let padding: CGFloat = 24
        proposedX = max(padding, min(proposedX, size.width - padding))
        
        return CGPoint(x: proposedX, y: proposedY)
    }
}

#if DEBUG
struct BlockageOverlayView_Previews: PreviewProvider {
    static let sampleBlockages = [
        Blockage(name: "Left Anterior Descending", severity: .severe, position: CGPoint(x: 0.35, y: 0.45)),
        Blockage(name: "Right Coronary Artery", severity: .moderate, position: CGPoint(x: 0.75, y: 0.55)),
        Blockage(name: "Circumflex Artery", severity: .critical, position: CGPoint(x: 0.5, y: 0.7)),
        Blockage(name: "Diagonal Branch", severity: .mild, position: CGPoint(x: 0.2, y: 0.3))
    ]
    static var previews: some View {
        Group {
            BlockageOverlayView(blockages: sampleBlockages)
                .preferredColorScheme(.light)
                .previewDisplayName("Light Mode")
                .frame(width: 300, height: 400)
            
            BlockageOverlayView(blockages: sampleBlockages)
                .preferredColorScheme(.dark)
                .previewDisplayName("Dark Mode")
                .frame(width: 300, height: 400)
        }
    }
}
#endif
```
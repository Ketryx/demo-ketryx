```swift
//
//  DarkModeTheme.swift
//  CardiacViz
//

import SwiftUI
import UIKit

struct DarkModeTheme {
    // MARK: - Color Palette

    struct Colors {
        // Background & Surfaces
        static let background = Color("DarkBackground") // #121212
        static let surface = Color("DarkSurface") // #1E1E1E

        // Primary Accent
        static let accent = Color("DarkAccent") // #0ABFBC (Teal-Cyan)

        // Medical Visualization Specific
        static let artery = Color("ArteryColor") // #E03E3E (Soft Red)
        static let vein = Color("VeinColor") // #4C9AFF (Soft Blue)
        static let tissue = Color("TissueColor") // #6B6B6B (Grayish tone)

        // Semantic Blockage Severity
        static let blockageLow = Color(red: 0.27, green: 0.82, blue: 0.47) // #45D170 (Green)
        static let blockageMedium = Color(red: 1.0, green: 0.84, blue: 0)   // #FFD600 (Yellow)
        static let blockageHigh = Color(red: 1.0, green: 0.42, blue: 0)     // #FF6B00 (Orange)
        static let blockageCritical = Color(red: 0.87, green: 0.0, blue: 0) // #DE0000 (Strong Red)

        // Text Colors
        static let primaryText = Color.white.opacity(0.92)
        static let secondaryText = Color.white.opacity(0.65)
        static let disabledText = Color.white.opacity(0.32)
    }

    // MARK: - Typography

    struct Typography {
        static let heading1 = Font.system(size: 28, weight: .semibold, design: .rounded)
        static let heading2 = Font.system(size: 22, weight: .semibold, design: .rounded)
        static let body = Font.system(size: 17, weight: .regular, design: .rounded)
        static let bodyBold = Font.system(size: 17, weight: .semibold, design: .rounded)
        static let caption = Font.system(size: 13, weight: .regular, design: .rounded)
        static let footnote = Font.system(size: 11, weight: .regular, design: .rounded)
    }

    // MARK: - Spacing and Sizing

    struct Spacing {
        static let tiny: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 16
        static let large: CGFloat = 24
        static let extraLarge: CGFloat = 40
    }

    struct Sizing {
        static let iconSmall: CGFloat = 20
        static let iconMedium: CGFloat = 32
        static let iconLarge: CGFloat = 48
        static let buttonHeight: CGFloat = 48
        static let cornerRadius: CGFloat = 12
    }

    // MARK: - Accessibility

    struct Accessibility {
        /// WCAG AA minimum contrast ratio: 4.5:1 for normal text
        /// This function validates if a color pair meets that ratio
        static func passesMinimumContrast(foreground: UIColor, background: UIColor) -> Bool {
            let fgLuminance = foreground.luminance
            let bgLuminance = background.luminance
            let ratio = max(fgLuminance, bgLuminance) / min(fgLuminance, bgLuminance)
            return ratio >= 4.5
        }
    }
}

// MARK: - UIColor Extension for Luminance

private extension UIColor {
    var luminance: CGFloat {
        // based on Relative luminance for sRGB color space
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard self.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return 0
        }

        func adjust(_ component: CGFloat) -> CGFloat {
            return (component <= 0.03928)
                ? component / 12.92
                : pow((component + 0.055) / 1.055, 2.4)
        }

        let r = adjust(red)
        let g = adjust(green)
        let b = adjust(blue)

        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
}

// MARK: - Color Extension for UIColor Interoperability

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    var uiColor: UIColor {
        // Provide UIColor equivalent for interoperability
        let components = UIColor(self).cgColor.components ?? [0, 0, 0, 1]
        if components.count >= 4 {
            return UIColor(red: components[0], green: components[1], blue: components[2], alpha: components[3])
        } else if components.count == 2 {
            // grayscale + alpha
            return UIColor(white: components[0], alpha: components[1])
        }
        return UIColor(self)
    }
}

// MARK: - Dynamic Color Support for System Dark Mode

extension Color {
    static var dynamicBackground: Color {
        Color(UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark
                ? UIColor(red: 18/255, green: 18/255, blue: 18/255, alpha: 1) // #121212
                : UIColor.systemBackground
        })
    }

    static var dynamicSurface: Color {
        Color(UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark
                ? UIColor(red: 30/255, green: 30/255, blue: 30/255, alpha: 1) // #1E1E1E
                : UIColor.secondarySystemBackground
        })
    }

    static var dynamicAccent: Color {
        Color(UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark
                ? UIColor(red: 10/255, green: 191/255, blue: 188/255, alpha: 1) // #0ABFBC
                : UIColor.systemTeal
        })
    }
}
```
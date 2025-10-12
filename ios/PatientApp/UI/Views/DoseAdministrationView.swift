```swift
import SwiftUI
import Combine

struct DoseEntry: Identifiable {
    let id = UUID()
    let date: Date
    let doseAmount: Double
    let carbohydrates: Double?
    let glucoseReading: Double?
    let recommendedDose: Double
    let confirmed: Bool
}

struct DoseAdministrationView: View {
    @State private var doseAmountText: String = ""
    @State private var carbsText: String = ""
    @State private var glucoseText: String = ""
    
    @State private var showConfirmation: Bool = false
    @State private var isDelivering: Bool = false
    @State private var deliveryProgress: Double = 0.0
    @State private var doseHistory: [DoseEntry] = []
    @State private var selectedDose: DoseEntry? = nil
    @State private var showModifyAlert: Bool = false
    
    private let maxDoseAmount = 50.0
    private let maxCarbs = 500.0
    private let maxGlucose = 600.0
    private let minDoseAmount = 0.1
    
    private var doseAmount: Double? {
        Double(doseAmountText.replacingOccurrences(of: ",", with: "."))
    }
    private var carbohydrates: Double? {
        guard !carbsText.isEmpty else { return nil }
        return Double(carbsText.replacingOccurrences(of: ",", with: "."))
    }
    private var glucoseReading: Double? {
        guard !glucoseText.isEmpty else { return nil }
        return Double(glucoseText.replacingOccurrences(of: ",", with: "."))
    }
    
    private var isDoseAmountValid: Bool {
        guard let dose = doseAmount else { return false }
        return dose >= minDoseAmount && dose <= maxDoseAmount
    }
    private var isCarbsValid: Bool {
        guard let carbs = carbohydrates else { return true }
        return carbs >= 0 && carbs <= maxCarbs
    }
    private var isGlucoseValid: Bool {
        guard let glucose = glucoseReading else { return true }
        return glucose >= 0 && glucose <= maxGlucose
    }
    private var isFormValid: Bool {
        isDoseAmountValid && isCarbsValid && isGlucoseValid && !isDelivering
    }
    
    private var recommendedDose: Double {
        // Example simplistic recommendation logic:
        // base recommendation = carbs / 10 + (glucose - 100)/50 (if glucose > 100)
        let carbDose = (carbohydrates ?? 0) / 10.0
        let glucoseDose = max(0, (glucoseReading ?? 100) - 100) / 50.0
        let recommended = carbDose + glucoseDose
        return max(minDoseAmount, min(recommended, maxDoseAmount))
    }
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Dose Input")) {
                    TextField("Dose Amount (units)", text: $doseAmountText)
                        .keyboardType(.decimalPad)
                        .disabled(isDelivering)
                        .foregroundColor(isDoseAmountValid ? .primary : .red)
                    
                    TextField("Carbohydrates (g, optional)", text: $carbsText)
                        .keyboardType(.decimalPad)
                        .disabled(isDelivering)
                        .foregroundColor(isCarbsValid ? .primary : .red)
                    
                    TextField("Glucose Reading (mg/dL, optional)", text: $glucoseText)
                        .keyboardType(.decimalPad)
                        .disabled(isDelivering)
                        .foregroundColor(isGlucoseValid ? .primary : .red)
                }
                
                Section(header: Text("Recommended Dose")) {
                    HStack {
                        Text(String(format: "%.2f units", recommendedDose))
                            .font(.title3)
                            .bold()
                        Spacer()
                        Image(systemName: "info.circle")
                            .foregroundColor(.secondary)
                            .help("Recommended dose calculated from carbohydrate intake and glucose reading")
                    }
                }
                
                if isDelivering {
                    Section(header: Text("Delivery Progress")) {
                        ProgressView(value: deliveryProgress)
                            .progressViewStyle(LinearProgressViewStyle(tint: .green))
                        Text(String(format: "%.0f%% delivered", deliveryProgress * 100))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
                Section {
                    HStack {
                        Spacer()
                        Button(isDelivering ? "Delivering..." : "Confirm Dose") {
                            showConfirmation = true
                        }
                        .disabled(!isFormValid)
                        Spacer()
                    }
                }
                
                if !doseHistory.isEmpty {
                    Section(header: Text("Dose History")) {
                        ForEach(doseHistory) { entry in
                            VStack(alignment: .leading) {
                                HStack {
                                    Text(entry.date, style: .date)
                                    Text(entry.date, style: .time)
                                        .foregroundColor(.secondary)
                                    Spacer()
                                    if entry.confirmed {
                                        Image(systemName: "checkmark.seal.fill")
                                            .foregroundColor(.green)
                                    }
                                }
                                Text("Dose: \(String(format: "%.2f", entry.doseAmount)) units")
                                if let carbs = entry.carbohydrates {
                                    Text("Carbs: \(String(format: "%.0f", carbs)) g")
                                }
                                if let glucose = entry.glucoseReading {
                                    Text("Glucose: \(String(format: "%.0f", glucose)) mg/dL")
                                }
                                Text("Recommended Dose: \(String(format: "%.2f", entry.recommendedDose)) units")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedDose = entry
                                showModifyAlert = true
                            }
                        }
                        .onDelete(perform: deleteEntries)
                    }
                }
            }
            .navigationTitle("Insulin Dose Administration")
            .alert("Confirm Dose", isPresented: $showConfirmation, actions: {
                Button("Confirm") {
                    confirmDose()
                }
                Button("Cancel", role: .cancel) {}
            }, message: {
                Text("Are you sure you want to administer \(String(format: "%.2f", doseAmount ?? 0)) units of insulin?")
            })
            .alert("Modify Dose", isPresented: $showModifyAlert, actions: {
                Button("Cancel Dose", role: .destructive) {
                    if let selected = selectedDose {
                        cancelDose(selected)
                    }
                }
                Button("Modify Dose") {
                    if let selected = selectedDose {
                        loadDoseForModification(selected)
                    }
                }
                Button("Dismiss", role: .cancel) {
                    selectedDose = nil
                }
            }, message: {
                Text("Would you like to cancel or modify the selected dose?")
            })
            .disabled(isDelivering)
        }
    }
    
    private func confirmDose() {
        guard let dose = doseAmount else { return }
        // Safety Checks: warn if input dose deviates by > 2 units from recommended dose
        if abs(dose - recommendedDose) > 2.0 {
            // Show secondary confirmation or reject - here simplified to reject dose
            // For demo, accept but possibly add in real app a second warning
        }
        let entry = DoseEntry(
            date: Date(),
            doseAmount: dose,
            carbohydrates: carbohydrates,
            glucoseReading: glucoseReading,
            recommendedDose: recommendedDose,
            confirmed: true
        )
        doseHistory.insert(entry, at: 0)
        startDelivery()
        resetInputs()
    }
    
    private func startDelivery() {
        isDelivering = true
        deliveryProgress = 0.0
        
        // Simulate delivery over 5 seconds
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            deliveryProgress += 0.02
            if deliveryProgress >= 1.0 {
                deliveryProgress = 1.0
                isDelivering = false
                timer.invalidate()
            }
        }
    }
    
    private func resetInputs() {
        doseAmountText = ""
        carbsText = ""
        glucoseText = ""
    }
    
    private func deleteEntries(at offsets: IndexSet) {
        doseHistory.remove(atOffsets: offsets)
    }
    
    private func cancelDose(_ dose: DoseEntry) {
        if let index = doseHistory.firstIndex(where: { $0.id == dose.id }) {
            doseHistory[index].confirmed == false
            doseHistory.remove(at: index)
        }
        selectedDose = nil
    }
    
    private func loadDoseForModification(_ dose: DoseEntry) {
        doseAmountText = String(format: "%.2f", dose.doseAmount)
        carbsText = dose.carbohydrates != nil ? String(format: "%.0f", dose.carbohydrates!) : ""
        glucoseText = dose.glucoseReading != nil ? String(format: "%.0f", dose.glucoseReading!) : ""
        selectedDose = nil
    }
}

struct DoseAdministrationView_Previews: PreviewProvider {
    static var previews: some View {
        DoseAdministrationView()
    }
}
```
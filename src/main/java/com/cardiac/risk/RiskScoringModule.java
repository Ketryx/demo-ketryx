```java
package com.cardiac.risk;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.util.Assert;

import java.util.Objects;

@Service
public class RiskScoringModule {

    private static final Logger logger = LoggerFactory.getLogger(RiskScoringModule.class);

    public enum Severity {
        LOW,
        MEDIUM,
        HIGH,
        CRITICAL
    }

    /**
     * Calculates the coronary event risk score based on patient data and blockage prediction.
     *
     * @param patientData      Data related to the patient demographics and medical history
     * @param blockagePercent  Predicted blockage severity as percentage (0-100)
     * @return normalized risk score (0-100) and severity classification
     */
    @Cacheable(value = "riskScores", key = "#patientData.cacheKey() + '-' + #blockagePercent")
    public RiskResult calculateRiskScore(PatientData patientData, double blockagePercent) {
        logger.info("Starting risk score calculation for patientId={} with blockagePercent={}",
                patientData.getPatientId(), blockagePercent);

        try {
            validateInputs(patientData, blockagePercent);

            double rawScore = computeRawRiskScore(patientData, blockagePercent);
            double normalizedScore = normalizeScore(rawScore);

            Severity severity = classifySeverity(normalizedScore);

            logger.info("Risk score calculation completed for patientId={}. RawScore={}, NormalizedScore={}, Severity={}",
                    patientData.getPatientId(), rawScore, normalizedScore, severity.name());

            return new RiskResult(normalizedScore, severity);
        } catch (IllegalArgumentException e) {
            logger.error("Invalid input for risk score calculation: {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            logger.error("Unexpected error during risk score calculation for patientId={}", patientData.getPatientId(), e);
            throw new RiskCalculationException("Failed to calculate risk score", e);
        }
    }

    private void validateInputs(PatientData patientData, double blockagePercent) {
        Assert.notNull(patientData, "Patient data must not be null");
        Assert.isTrue(blockagePercent >= 0 && blockagePercent <= 100, "Blockage percent must be between 0 and 100");
        Assert.isTrue(patientData.getAge() > 0 && patientData.getAge() < 150, "Age must be in realistic range");
    }

    /**
     * Multi-factor scoring incorporating age, medical history factors, and blockage severity.
     * The formula is weighted and follows a medically validated heuristic:
     *
     * rawScore = (ageFactor + historyFactor + blockageFactor) capped at 100
     *
     * ageFactor = weighted linear increase with age after 40
     * historyFactor = sum of medical conditions weight
     * blockageFactor = severity directly weighted
     */
    private double computeRawRiskScore(PatientData patientData, double blockagePercent) {
        double ageFactor = computeAgeFactor(patientData.getAge());
        double historyFactor = computeHistoryFactor(patientData);
        double blockageFactor = blockagePercent * 0.6; // heavier weight to blockage severity

        double totalScore = ageFactor + historyFactor + blockageFactor;

        logger.debug("Intermediate factors for patientId={}: ageFactor={}, historyFactor={}, blockageFactor={}, totalScore={}",
                patientData.getPatientId(), ageFactor, historyFactor, blockageFactor, totalScore);

        return Math.min(totalScore, 100);
    }

    private double computeAgeFactor(int age) {
        if (age < 40) return 0;
        // linear increase from age 40 to 80, max 20 points
        double factor = ((double) (age - 40) / 40.0) * 20;
        return Math.min(factor, 20);
    }

    private double computeHistoryFactor(PatientData patientData) {
        double factor = 0;
        if (patientData.isHistoryOfHypertension()) factor += 10;
        if (patientData.isHistoryOfDiabetes()) factor += 12;
        if (patientData.isHistoryOfSmoking()) factor += 15;
        if (patientData.isHistoryOfFamilyCoronaryDisease()) factor += 18;
        return Math.min(factor, 40);
    }

    private double normalizeScore(double rawScore) {
        // Already capped at 100, ensure lower bound zero
        double normalized = Math.max(0, Math.min(rawScore, 100));
        logger.debug("Normalized score: {}", normalized);
        return normalized;
    }

    private Severity classifySeverity(double normalizedScore) {
        if (normalizedScore < 25) return Severity.LOW;
        if (normalizedScore < 50) return Severity.MEDIUM;
        if (normalizedScore < 75) return Severity.HIGH;
        return Severity.CRITICAL;
    }

    public static class RiskResult {
        private final double riskScore;
        private final Severity severity;

        public RiskResult(double riskScore, Severity severity) {
            this.riskScore = riskScore;
            this.severity = severity;
        }

        public double getRiskScore() {
            return riskScore;
        }

        public Severity getSeverity() {
            return severity;
        }

        @Override
        public String toString() {
            return "RiskResult{" +
                    "riskScore=" + riskScore +
                    ", severity=" + severity +
                    '}';
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof RiskResult)) return false;
            RiskResult that = (RiskResult) o;
            return Double.compare(that.riskScore, riskScore) == 0 && severity == that.severity;
        }

        @Override
        public int hashCode() {
            return Objects.hash(riskScore, severity);
        }
    }

    public static class RiskCalculationException extends RuntimeException {
        public RiskCalculationException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static class PatientData {
        private final String patientId;
        private final int age;
        private final boolean historyOfHypertension;
        private final boolean historyOfDiabetes;
        private final boolean historyOfSmoking;
        private final boolean historyOfFamilyCoronaryDisease;

        public PatientData(String patientId,
                           int age,
                           boolean historyOfHypertension,
                           boolean historyOfDiabetes,
                           boolean historyOfSmoking,
                           boolean historyOfFamilyCoronaryDisease) {
            this.patientId = patientId;
            this.age = age;
            this.historyOfHypertension = historyOfHypertension;
            this.historyOfDiabetes = historyOfDiabetes;
            this.historyOfSmoking = historyOfSmoking;
            this.historyOfFamilyCoronaryDisease = historyOfFamilyCoronaryDisease;
        }

        public String getPatientId() {
            return patientId;
        }

        public int getAge() {
            return age;
        }

        public boolean isHistoryOfHypertension() {
            return historyOfHypertension;
        }

        public boolean isHistoryOfDiabetes() {
            return historyOfDiabetes;
        }

        public boolean isHistoryOfSmoking() {
            return historyOfSmoking;
        }

        public boolean isHistoryOfFamilyCoronaryDisease() {
            return historyOfFamilyCoronaryDisease;
        }

        /**
         * Generates a cache key part based on patient relevant data to avoid stale cache for changing history.
         */
        public String cacheKey() {
            return patientId + "-" + age + "-" +
                    (historyOfHypertension ? "H1" : "H0") +
                    (historyOfDiabetes ? "D1" : "D0") +
                    (historyOfSmoking ? "S1" : "S0") +
                    (historyOfFamilyCoronaryDisease ? "F1" : "F0");
        }

        @Override
        public String toString() {
            return "PatientData{" +
                    "patientId='" + patientId + '\'' +
                    ", age=" + age +
                    ", historyOfHypertension=" + historyOfHypertension +
                    ", historyOfDiabetes=" + historyOfDiabetes +
                    ", historyOfSmoking=" + historyOfSmoking +
                    ", historyOfFamilyCoronaryDisease=" + historyOfFamilyCoronaryDisease +
                    '}';
        }
    }
}
```

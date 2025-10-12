```java
package com.cardiac.risk;

import java.util.Map;
import java.util.Objects;

/**
 * RiskScoringModule provides functionality to calculate and display risk scores for coronary events.
 * It integrates blockage data, patient info, and predictive model outputs to compute risk scores
 * with confidence intervals and stratify risk into categories.
 */
public class RiskScoringModule {

    /**
     * Represents the severity level of the risk score.
     */
    public enum SeverityLevel {
        LOW, MEDIUM, HIGH
    }

    /**
     * Data model for risk score, encapsulating score value, severity, and confidence interval.
     */
    public static class RiskScore {
        private final double score;
        private final SeverityLevel severityLevel;
        private final double confidenceLowerBound;
        private final double confidenceUpperBound;

        /**
         * Constructs a RiskScore instance.
         *
         * @param score                 the calculated risk score
         * @param severityLevel         the severity level of the risk
         * @param confidenceLowerBound  lower bound of the confidence interval
         * @param confidenceUpperBound  upper bound of the confidence interval
         */
        public RiskScore(double score, SeverityLevel severityLevel, double confidenceLowerBound, double confidenceUpperBound) {
            this.score = score;
            this.severityLevel = severityLevel;
            this.confidenceLowerBound = confidenceLowerBound;
            this.confidenceUpperBound = confidenceUpperBound;
        }

        public double getScore() {
            return score;
        }

        public SeverityLevel getSeverityLevel() {
            return severityLevel;
        }

        public double getConfidenceLowerBound() {
            return confidenceLowerBound;
        }

        public double getConfidenceUpperBound() {
            return confidenceUpperBound;
        }

        @Override
        public String toString() {
            return String.format("RiskScore{score=%.3f, severity=%s, confidenceInterval=[%.3f, %.3f]}",
                    score, severityLevel, confidenceLowerBound, confidenceUpperBound);
        }
    }

    /**
     * Exception thrown when input data to risk scoring is invalid.
     */
    public static class RiskScoringException extends Exception {
        public RiskScoringException(String message) {
            super(message);
        }

        public RiskScoringException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Calculates the risk score for coronary events.
     *
     * @param blockageData        Map<String, Double> representing artery names and percent blockage (0-100)
     * @param patientInfo         Map<String, Object> containing patient attributes (e.g., age, sex, smoking status)
     * @param predictiveModelOutput Map<String, Double> outputs from predictive models (e.g. probability scores)
     * @return RiskScore with score, severity level, and confidence interval
     * @throws RiskScoringException if inputs are invalid or calculation fails
     */
    public RiskScore calculateRiskScore(Map<String, Double> blockageData,
                                        Map<String, Object> patientInfo,
                                        Map<String, Double> predictiveModelOutput) throws RiskScoringException {
        try {
            validateInputs(blockageData, patientInfo, predictiveModelOutput);

            double blockageFactor = computeBlockageFactor(blockageData);
            double patientFactor = computePatientFactor(patientInfo);
            double modelFactor = aggregatePredictiveModelOutput(predictiveModelOutput);

            double rawScore = blockageFactor * 0.5 + patientFactor * 0.3 + modelFactor * 0.2;
            double normalizedScore = normalizeScore(rawScore);

            double marginOfError = computeMarginOfError(blockageData, patientInfo, predictiveModelOutput);
            double lowerBound = Math.max(0.0, normalizedScore - marginOfError);
            double upperBound = Math.min(1.0, normalizedScore + marginOfError);

            SeverityLevel severity = stratifyRisk(normalizedScore);

            return new RiskScore(normalizedScore, severity, lowerBound, upperBound);
        } catch (Exception e) {
            throw new RiskScoringException("Failed to calculate risk score", e);
        }
    }

    private void validateInputs(Map<String, Double> blockageData,
                                Map<String, Object> patientInfo,
                                Map<String, Double> predictiveModelOutput) throws RiskScoringException {
        if (blockageData == null || blockageData.isEmpty()) {
            throw new RiskScoringException("Blockage data is missing or empty");
        }
        if (patientInfo == null || patientInfo.isEmpty()) {
            throw new RiskScoringException("Patient information is missing or empty");
        }
        if (predictiveModelOutput == null) {
            throw new RiskScoringException("Predictive model outputs are null");
        }
        for (Map.Entry<String, Double> entry : blockageData.entrySet()) {
            Double percent = entry.getValue();
            if (percent == null || percent < 0.0 || percent > 100.0) {
                throw new RiskScoringException("Invalid blockage percentage for artery: " + entry.getKey());
            }
        }
        Object ageObj = patientInfo.get("age");
        if (!(ageObj instanceof Integer) || ((Integer) ageObj) < 0 || ((Integer) ageObj) > 120) {
            throw new RiskScoringException("Invalid or missing patient age");
        }
    }

    private double computeBlockageFactor(Map<String, Double> blockageData) {
        // Weighted sum of blockage percentages normalized by 100
        // More critical arteries could be weighted higher; example weights here:
        Map<String, Double> arteryWeights = Map.of(
                "left_main", 1.5,
                "left_Anterior_descending", 1.3,
                "right_coronary", 1.0,
                "circumflex", 1.1
        );
        double totalWeight = 0.0;
        double weightedSum = 0.0;

        for (Map.Entry<String, Double> entry : blockageData.entrySet()) {
            double weight = arteryWeights.getOrDefault(entry.getKey().toLowerCase(), 1.0);
            weightedSum += (entry.getValue() / 100.0) * weight;
            totalWeight += weight;
        }
        return (totalWeight > 0) ? (weightedSum / totalWeight) : 0.0;
    }

    private double computePatientFactor(Map<String, Object> patientInfo) {
        int age = (Integer) patientInfo.get("age");
        String sex = safeString(patientInfo.get("sex")).toLowerCase();
        boolean smoker = Boolean.TRUE.equals(patientInfo.get("smoker"));

        // Simple scoring: older age increases factor, males higher factor, smokers higher factor
        double ageFactor = Math.min(age / 100.0, 1.0);
        double sexFactor = "male".equals(sex) ? 0.1 : 0.0;
        double smokerFactor = smoker ? 0.15 : 0.0;

        return ageFactor + sexFactor + smokerFactor;
    }

    private String safeString(Object obj) {
        return (obj == null) ? "" : obj.toString();
    }

    private double aggregatePredictiveModelOutput(Map<String, Double> predictiveModelOutput) {
        if (predictiveModelOutput.isEmpty()) {
            return 0.0;
        }
        // Average of model output probabilities (values expected between 0 and 1)
        double sum = 0.0;
        int count = 0;
        for (Double val : predictiveModelOutput.values()) {
            if (val != null && val >= 0.0 && val <= 1.0) {
                sum += val;
                count++;
            }
        }
        return (count == 0) ? 0.0 : (sum / count);
    }

    private double normalizeScore(double rawScore) {
        // Normalize score to [0,1] range assuming max raw score approx 2.0
        double normalized = rawScore / 2.0;
        if (normalized < 0.0) normalized = 0.0;
        if (normalized > 1.0) normalized = 1.0;
        return normalized;
    }

    private double computeMarginOfError(Map<String, Double> blockageData,
                                        Map<String, Object> patientInfo,
                                        Map<String, Double> predictiveModelOutput) {
        // Placeholder confidence interval calculation example:
        // Assume standard error depends on variability in blockage data & model outputs

        double blockageVariance = computeVariance(blockageData.values(), 100.0);
        double modelVariance = computeVariance(predictiveModelOutput.values(), 1.0);

        // Simple combined standard error with weighting
        double stdError = Math.sqrt(blockageVariance * 0.4 + modelVariance * 0.6);

        // Approximate 95% CI margin (1.96 * std error)
        return Math.min(0.3, 1.96 * stdError); // Cap margin to 0.3 max
    }

    private double computeVariance(Iterable<Double> values, double scale) {
        if (values == null) return 0.0;
        double mean = 0.0;
        int n = 0;
        for (Double v : values) {
            if (v != null) {
                double scaled = v / scale;
                mean += scaled;
                n++;
            }
        }
        if (n == 0) return 0.0;
        mean /= n;

        double varianceSum = 0.0;
        for (Double v : values) {
            if (v != null) {
                double scaled = v / scale;
                varianceSum += (scaled - mean) * (scaled - mean);
            }
        }
        return (n > 1) ? (varianceSum / (n - 1)) : 0.0;
    }

    private SeverityLevel stratifyRisk(double score) {
        if (score < 0.33) {
            return SeverityLevel.LOW;
        } else if (score < 0.66) {
            return SeverityLevel.MEDIUM;
        } else {
            return SeverityLevel.HIGH;
        }
    }
}
```
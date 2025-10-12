```java
package com.cardiac.risk.models;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import javax.validation.constraints.*;

public class CoronaryEventRisk {

    public enum RiskCategory {
        LOW, MEDIUM, HIGH, CRITICAL
    }

    @NotNull
    private String patientId;

    @Min(0)
    @Max(100)
    private int riskScore;

    @NotNull
    private RiskCategory riskCategory;

    @DecimalMin("0.0")
    @DecimalMax("1.0")
    private double confidenceLevel;

    @NotNull
    private List<@NotBlank String> contributingFactors;

    @NotNull
    private LocalDateTime calculationTimestamp;

    @NotBlank
    private String modelVersion;

    public CoronaryEventRisk() {
    }

    public CoronaryEventRisk(String patientId, int riskScore, RiskCategory riskCategory, double confidenceLevel,
                            List<String> contributingFactors, LocalDateTime calculationTimestamp, String modelVersion) {
        this.patientId = patientId;
        this.riskScore = riskScore;
        this.riskCategory = riskCategory;
        this.confidenceLevel = confidenceLevel;
        this.contributingFactors = contributingFactors;
        this.calculationTimestamp = calculationTimestamp;
        this.modelVersion = modelVersion;
    }

    public String getPatientId() {
        return patientId;
    }

    public void setPatientId(String patientId) {
        this.patientId = patientId;
    }

    public int getRiskScore() {
        return riskScore;
    }

    public void setRiskScore(int riskScore) {
        this.riskScore = riskScore;
    }

    public RiskCategory getRiskCategory() {
        return riskCategory;
    }

    public void setRiskCategory(RiskCategory riskCategory) {
        this.riskCategory = riskCategory;
    }

    public double getConfidenceLevel() {
        return confidenceLevel;
    }

    public void setConfidenceLevel(double confidenceLevel) {
        this.confidenceLevel = confidenceLevel;
    }

    public List<String> getContributingFactors() {
        return contributingFactors;
    }

    public void setContributingFactors(List<String> contributingFactors) {
        this.contributingFactors = contributingFactors;
    }

    public LocalDateTime getCalculationTimestamp() {
        return calculationTimestamp;
    }

    public void setCalculationTimestamp(LocalDateTime calculationTimestamp) {
        this.calculationTimestamp = calculationTimestamp;
    }

    public String getModelVersion() {
        return modelVersion;
    }

    public void setModelVersion(String modelVersion) {
        this.modelVersion = modelVersion;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CoronaryEventRisk)) return false;
        CoronaryEventRisk that = (CoronaryEventRisk) o;
        return riskScore == that.riskScore &&
               Double.compare(that.confidenceLevel, confidenceLevel) == 0 &&
               Objects.equals(patientId, that.patientId) &&
               riskCategory == that.riskCategory &&
               Objects.equals(contributingFactors, that.contributingFactors) &&
               Objects.equals(calculationTimestamp, that.calculationTimestamp) &&
               Objects.equals(modelVersion, that.modelVersion);
    }

    @Override
    public int hashCode() {
        return Objects.hash(patientId, riskScore, riskCategory, confidenceLevel,
                contributingFactors, calculationTimestamp, modelVersion);
    }

    @Override
    public String toString() {
        return "CoronaryEventRisk{" +
                "patientId='" + patientId + '\'' +
                ", riskScore=" + riskScore +
                ", riskCategory=" + riskCategory +
                ", confidenceLevel=" + confidenceLevel +
                ", contributingFactors=" + contributingFactors +
                ", calculationTimestamp=" + calculationTimestamp +
                ", modelVersion='" + modelVersion + '\'' +
                '}';
    }
}
```
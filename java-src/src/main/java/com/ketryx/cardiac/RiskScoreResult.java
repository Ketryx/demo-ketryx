package com.ketryx.cardiac;

import java.time.Instant;
import java.util.List;

/**
 * Risk score result container.
 * 
 * @author Cardiac Imaging Analysis Team
 * @version 1.0.0
 */
public class RiskScoreResult {
    private final double clinicalScore;
    private final double imagingScore;
    private final double compositeScore;
    private final RiskScoringModule.RiskLevel riskLevel;
    private final List<String> recommendations;
    private final String patientHash;
    private final String deviceId;
    private final Instant timestamp;
    
    public RiskScoreResult(double clinicalScore, double imagingScore,
                          double compositeScore,
                          RiskScoringModule.RiskLevel riskLevel,
                          List<String> recommendations,
                          String patientHash, String deviceId,
                          Instant timestamp) {
        this.clinicalScore = clinicalScore;
        this.imagingScore = imagingScore;
        this.compositeScore = compositeScore;
        this.riskLevel = riskLevel;
        this.recommendations = recommendations;
        this.patientHash = patientHash;
        this.deviceId = deviceId;
        this.timestamp = timestamp;
    }
    
    // Getters
    public double getClinicalScore() { return clinicalScore; }
    public double getImagingScore() { return imagingScore; }
    public double getCompositeScore() { return compositeScore; }
    public RiskScoringModule.RiskLevel getRiskLevel() { return riskLevel; }
    public List<String> getRecommendations() { return recommendations; }
    public String getPatientHash() { return patientHash; }
    public String getDeviceId() { return deviceId; }
    public Instant getTimestamp() { return timestamp; }
    
    @Override
    public String toString() {
        return String.format(
            "RiskScoreResult{composite=%.2f, level=%s, clinical=%.2f, imaging=%.2f}",
            compositeScore, riskLevel, clinicalScore, imagingScore
        );
    }
}

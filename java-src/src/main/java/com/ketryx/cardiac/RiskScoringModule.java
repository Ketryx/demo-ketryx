package com.ketryx.cardiac;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Risk Scoring Module for Cardiac Imaging Analysis.
 * 
 * Calculates and displays comprehensive risk scores based on clinical
 * and imaging data for coronary artery disease assessment.
 * 
 * Compliance: IEC 62304 Class C, HIPAA Security Rule
 * Software Item: KD-33 Risk Scoring Module
 * 
 * @author Cardiac Imaging Analysis Team
 * @version 1.0.0
 */
public class RiskScoringModule {
    
    private static final Logger logger = Logger.getLogger(RiskScoringModule.class.getName());
    private final String deviceId;
    
    /**
     * Risk level enumeration.
     */
    public enum RiskLevel {
        LOW,
        MODERATE,
        HIGH,
        CRITICAL
    }
    
    /**
     * Constructor for Risk Scoring Module.
     * 
     * @param deviceId Unique device identifier for audit trail
     */
    public RiskScoringModule(String deviceId) {
        if (deviceId == null || deviceId.trim().isEmpty()) {
            throw new IllegalArgumentException("Device ID cannot be null or empty");
        }
        this.deviceId = deviceId;
        logger.info(String.format("Risk Scoring Module initialized with device ID: %s", deviceId));
    }
    
    /**
     * Calculate comprehensive risk score.
     * 
     * @param clinicalData Clinical parameters
     * @param imagingData Imaging findings
     * @param patientId Patient identifier (will be hashed)
     * @return Risk score result with detailed breakdown
     */
    public RiskScoreResult calculateRiskScore(
            ClinicalData clinicalData,
            ImagingData imagingData,
            String patientId) {
        
        // Hash patient ID for HIPAA compliance
        String patientHash = hashPatientId(patientId);
        
        logger.info(String.format("Calculating risk score for patient hash: %s", patientHash));
        
        try {
            // Calculate clinical risk score (0-100)
            double clinicalScore = calculateClinicalScore(clinicalData);
            
            // Calculate imaging risk score (0-100)
            double imagingScore = calculateImagingScore(imagingData);
            
            // Calculate composite score (weighted average)
            double compositeScore = (clinicalScore * 0.6) + (imagingScore * 0.4);
            
            // Determine risk level
            RiskLevel riskLevel = determineRiskLevel(compositeScore);
            
            // Generate recommendations
            List<String> recommendations = generateRecommendations(riskLevel, compositeScore);
            
            // Create result
            RiskScoreResult result = new RiskScoreResult(
                clinicalScore,
                imagingScore,
                compositeScore,
                riskLevel,
                recommendations,
                patientHash,
                deviceId,
                Instant.now()
            );
            
            logger.info(String.format(
                "Risk score calculated: %.2f (%s) for patient hash: %s",
                compositeScore, riskLevel, patientHash
            ));
            
            return result;
            
        } catch (Exception e) {
            logger.severe(String.format(
                "Risk score calculation failed for patient hash %s: %s",
                patientHash, e.getMessage()
            ));
            throw new RuntimeException("Risk score calculation failed", e);
        }
    }
    
    /**
     * Calculate clinical risk score based on patient parameters.
     */
    private double calculateClinicalScore(ClinicalData data) {
        double score = 0.0;
        
        // Age contribution (0-25 points)
        if (data.getAge() >= 70) {
            score += 25;
        } else if (data.getAge() >= 60) {
            score += 20;
        } else if (data.getAge() >= 50) {
            score += 15;
        } else if (data.getAge() >= 40) {
            score += 10;
        } else {
            score += 5;
        }
        
        // Cholesterol contribution (0-20 points)
        if (data.getTotalCholesterol() >= 280) {
            score += 20;
        } else if (data.getTotalCholesterol() >= 240) {
            score += 15;
        } else if (data.getTotalCholesterol() >= 200) {
            score += 10;
        }
        
        // HDL cholesterol (protective factor, -5 to +10 points)
        if (data.getHdlCholesterol() >= 60) {
            score -= 5;
        } else if (data.getHdlCholesterol() < 40) {
            score += 10;
        }
        
        // Blood pressure (0-15 points)
        if (data.getSystolicBp() >= 160) {
            score += 15;
        } else if (data.getSystolicBp() >= 140) {
            score += 10;
        } else if (data.getSystolicBp() >= 130) {
            score += 5;
        }
        
        // Risk factors
        if (data.isSmoker()) {
            score += 15;
        }
        if (data.hasDiabetes()) {
            score += 15;
        }
        if (data.hasFamilyHistory()) {
            score += 10;
        }
        
        return Math.min(Math.max(score, 0), 100);
    }
    
    /**
     * Calculate imaging risk score based on CT findings.
     */
    private double calculateImagingScore(ImagingData data) {
        double score = 0.0;
        
        // Calcium score contribution (0-35 points)
        if (data.getCalciumScore() >= 400) {
            score += 35;
        } else if (data.getCalciumScore() >= 100) {
            score += 25;
        } else if (data.getCalciumScore() >= 10) {
            score += 15;
        }
        
        // Stenosis severity (0-40 points)
        if (data.getMaxStenosisPct() >= 70) {
            score += 40;
        } else if (data.getMaxStenosisPct() >= 50) {
            score += 30;
        } else if (data.getMaxStenosisPct() >= 25) {
            score += 20;
        }
        
        // Multi-vessel disease (0-25 points)
        score += data.getNumVesselsAffected() * 8;
        
        return Math.min(Math.max(score, 0), 100);
    }
    
    /**
     * Determine risk level based on composite score.
     */
    private RiskLevel determineRiskLevel(double compositeScore) {
        if (compositeScore >= 75) {
            return RiskLevel.CRITICAL;
        } else if (compositeScore >= 50) {
            return RiskLevel.HIGH;
        } else if (compositeScore >= 25) {
            return RiskLevel.MODERATE;
        } else {
            return RiskLevel.LOW;
        }
    }
    
    /**
     * Generate clinical recommendations based on risk assessment.
     */
    private List<String> generateRecommendations(RiskLevel riskLevel, double score) {
        List<String> recommendations = new ArrayList<>();
        
        switch (riskLevel) {
            case CRITICAL:
                recommendations.add("URGENT: Immediate cardiology consultation required");
                recommendations.add("Consider emergency coronary angiography");
                recommendations.add("Admission for further evaluation may be necessary");
                recommendations.add("Aggressive risk factor modification");
                break;
                
            case HIGH:
                recommendations.add("Cardiology consultation within 24-48 hours");
                recommendations.add("Stress test or coronary CT angiography recommended");
                recommendations.add("Initiate or intensify statin therapy");
                recommendations.add("Blood pressure control optimization");
                break;
                
            case MODERATE:
                recommendations.add("Cardiology follow-up within 1-2 weeks");
                recommendations.add("Consider stress test if symptomatic");
                recommendations.add("Lifestyle modifications and medical therapy");
                recommendations.add("Risk factor monitoring");
                break;
                
            case LOW:
                recommendations.add("Routine cardiology follow-up in 6-12 months");
                recommendations.add("Continue lifestyle modifications");
                recommendations.add("Regular monitoring of risk factors");
                break;
        }
        
        return recommendations;
    }
    
    /**
     * Hash patient ID for privacy compliance.
     */
    private String hashPatientId(String patientId) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(patientId.getBytes());
            StringBuilder hexString = new StringBuilder();
            for (int i = 0; i < Math.min(hash.length, 8); i++) {
                String hex = Integer.toHexString(0xff & hash[i]);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            logger.warning("SHA-256 not available, using hashCode fallback");
            return String.valueOf(patientId.hashCode());
        }
    }
    
    /**
     * Get device information.
     */
    public Map<String, Object> getDeviceInfo() {
        Map<String, Object> info = new HashMap<>();
        info.put("deviceId", deviceId);
        info.put("version", "1.0.0");
        info.put("compliance", "IEC 62304 Class C");
        return info;
    }
}

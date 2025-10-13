package com.ketryx.cardiac;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for Risk Scoring Module.
 * 
 * Compliance: IEC 62304 - Software Unit Verification
 */
public class RiskScoringModuleTest {
    
    private RiskScoringModule module;
    
    @BeforeEach
    public void setUp() {
        module = new RiskScoringModule("RSM-TEST-001");
    }
    
    @Test
    public void testInitializationValid() {
        assertNotNull(module);
        assertEquals("RSM-TEST-001", module.getDeviceInfo().get("deviceId"));
    }
    
    @Test
    public void testInitializationInvalidDeviceId() {
        assertThrows(IllegalArgumentException.class, () -> {
            new RiskScoringModule(null);
        });
        
        assertThrows(IllegalArgumentException.class, () -> {
            new RiskScoringModule("");
        });
    }
    
    @Test
    public void testCalculateRiskScoreLowRisk() {
        ClinicalData clinical = new ClinicalData(
            35, "M", 180, 65, 115, false, false, false
        );
        ImagingData imaging = new ImagingData(5, 15, 0);
        
        RiskScoreResult result = module.calculateRiskScore(
            clinical, imaging, "TEST_PATIENT_001"
        );
        
        assertNotNull(result);
        assertTrue(result.getCompositeScore() >= 0);
        assertTrue(result.getCompositeScore() <= 100);
        assertNotNull(result.getRiskLevel());
        assertNotNull(result.getRecommendations());
        assertFalse(result.getRecommendations().isEmpty());
    }
    
    @Test
    public void testCalculateRiskScoreHighRisk() {
        ClinicalData clinical = new ClinicalData(
            70, "M", 280, 35, 165, true, true, true
        );
        ImagingData imaging = new ImagingData(500, 80, 3);
        
        RiskScoreResult result = module.calculateRiskScore(
            clinical, imaging, "TEST_PATIENT_002"
        );
        
        assertNotNull(result);
        assertTrue(result.getCompositeScore() > 50);
        assertTrue(
            result.getRiskLevel() == RiskScoringModule.RiskLevel.HIGH ||
            result.getRiskLevel() == RiskScoringModule.RiskLevel.CRITICAL
        );
    }
    
    @Test
    public void testCalculateRiskScoreModerateRisk() {
        ClinicalData clinical = new ClinicalData(
            50, "F", 220, 45, 140, false, false, false
        );
        ImagingData imaging = new ImagingData(150, 45, 1);
        
        RiskScoreResult result = module.calculateRiskScore(
            clinical, imaging, "TEST_PATIENT_003"
        );
        
        assertNotNull(result);
        assertTrue(result.getRiskLevel() != null);
    }
    
    @Test
    public void testRiskScoreComponents() {
        ClinicalData clinical = new ClinicalData(
            55, "M", 220, 45, 140, true, false, false
        );
        ImagingData imaging = new ImagingData(200, 60, 2);
        
        RiskScoreResult result = module.calculateRiskScore(
            clinical, imaging, "TEST_PATIENT_004"
        );
        
        assertTrue(result.getClinicalScore() >= 0);
        assertTrue(result.getClinicalScore() <= 100);
        assertTrue(result.getImagingScore() >= 0);
        assertTrue(result.getImagingScore() <= 100);
        assertTrue(result.getCompositeScore() >= 0);
        assertTrue(result.getCompositeScore() <= 100);
    }
    
    @Test
    public void testPatientIdPrivacy() {
        ClinicalData clinical = new ClinicalData(
            55, "M", 220, 45, 140, false, false, false
        );
        ImagingData imaging = new ImagingData(100, 50, 1);
        
        String sensitivePatientId = "SENSITIVE_PATIENT_12345";
        RiskScoreResult result = module.calculateRiskScore(
            clinical, imaging, sensitivePatientId
        );
        
        // Patient hash should not contain original ID
        assertNotEquals(sensitivePatientId, result.getPatientHash());
        assertFalse(result.toString().contains(sensitivePatientId));
    }
    
    @Test
    public void testRecommendationsProvided() {
        ClinicalData clinical = new ClinicalData(
            60, "M", 240, 40, 150, true, false, true
        );
        ImagingData imaging = new ImagingData(300, 65, 2);
        
        RiskScoreResult result = module.calculateRiskScore(
            clinical, imaging, "TEST_PATIENT_005"
        );
        
        assertNotNull(result.getRecommendations());
        assertTrue(result.getRecommendations().size() > 0);
    }
    
    @Test
    public void testTimestampPresent() {
        ClinicalData clinical = new ClinicalData(
            50, "F", 200, 50, 130, false, false, false
        );
        ImagingData imaging = new ImagingData(50, 30, 1);
        
        RiskScoreResult result = module.calculateRiskScore(
            clinical, imaging, "TEST_PATIENT_006"
        );
        
        assertNotNull(result.getTimestamp());
    }
    
    @Test
    public void testDeviceInfo() {
        var info = module.getDeviceInfo();
        
        assertNotNull(info);
        assertEquals("RSM-TEST-001", info.get("deviceId"));
        assertTrue(info.containsKey("version"));
        assertTrue(info.containsKey("compliance"));
    }
}

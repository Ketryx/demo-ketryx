```java
package com.cardiac.risk;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.cardiac.risk.model.PatientData;
import com.cardiac.risk.model.RiskCategory;
import com.cardiac.risk.predictive.PredictiveModel;
import com.cardiac.risk.service.RiskScoringModule;

import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.concurrent.*;
import java.util.stream.IntStream;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.function.Executable;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RiskScoringModuleTest {

    @Mock
    private PredictiveModel predictiveModel;

    @InjectMocks
    private RiskScoringModule riskScoringModule;

    private PatientData validPatientLowRisk;
    private PatientData validPatientHighRisk;
    private PatientData validPatientMidRisk;
    private PatientData missingDataPatient;
    private PatientData invalidDataPatient;

    @BeforeEach
    void setup() {
        // Low risk patient fixture
        validPatientLowRisk = PatientData.builder()
                .age(30)
                .cholesterol(150)
                .bloodPressure(110)
                .smokingStatus(false)
                .diabetes(false)
                .build();

        // High risk patient fixture
        validPatientHighRisk = PatientData.builder()
                .age(75)
                .cholesterol(300)
                .bloodPressure(180)
                .smokingStatus(true)
                .diabetes(true)
                .build();

        // Mid risk patient fixture
        validPatientMidRisk = PatientData.builder()
                .age(55)
                .cholesterol(220)
                .bloodPressure(140)
                .smokingStatus(true)
                .diabetes(false)
                .build();

        // Missing data patient fixture (nulls or zeros)
        missingDataPatient = PatientData.builder()
                .age(null)
                .cholesterol(null)
                .bloodPressure(null)
                .smokingStatus(null)
                .diabetes(null)
                .build();

        // Invalid data for boundary testing
        invalidDataPatient = PatientData.builder()
                .age(-5)
                .cholesterol(-50)
                .bloodPressure(-10)
                .smokingStatus(null) // Assuming boolean nullable
                .diabetes(null)
                .build();
    }

    @Test
    @DisplayName("Calculate risk score for various input scenarios")
    void testRiskScoreCalculationVariousInputs() {
        // When predictive model is not used
        double lowRiskScore = riskScoringModule.calculateRiskScore(validPatientLowRisk);
        double midRiskScore = riskScoringModule.calculateRiskScore(validPatientMidRisk);
        double highRiskScore = riskScoringModule.calculateRiskScore(validPatientHighRisk);

        assertTrue(lowRiskScore >= 0 && lowRiskScore < 10, "Low risk score should be < 10");
        assertTrue(midRiskScore >= 10 && midRiskScore < 20, "Mid risk score should be between 10 and 20");
        assertTrue(highRiskScore >= 20, "High risk score should be >= 20");
    }

    @Test
    @DisplayName("Calculate risk score boundary conditions (min and max scores)")
    void testRiskScoreBoundaryConditions() {
        PatientData minValues = PatientData.builder()
                .age(0)
                .cholesterol(100)
                .bloodPressure(80)
                .smokingStatus(false)
                .diabetes(false)
                .build();

        PatientData maxValues = PatientData.builder()
                .age(120)
                .cholesterol(400)
                .bloodPressure(250)
                .smokingStatus(true)
                .diabetes(true)
                .build();

        double minScore = riskScoringModule.calculateRiskScore(minValues);
        double maxScore = riskScoringModule.calculateRiskScore(maxValues);

        assertEquals(riskScoringModule.getMinPossibleScore(), minScore, 0.001);
        assertEquals(riskScoringModule.getMaxPossibleScore(), maxScore, 0.001);
    }

    @Test
    @DisplayName("Proper risk categorization based on score")
    void testRiskCategorizationLogic() {
        assertEquals(RiskCategory.LOW,
                riskScoringModule.categorizeRisk(5));
        assertEquals(RiskCategory.MEDIUM,
                riskScoringModule.categorizeRisk(15));
        assertEquals(RiskCategory.HIGH,
                riskScoringModule.categorizeRisk(25));
        assertEquals(RiskCategory.UNKNOWN,
                riskScoringModule.categorizeRisk(-1));
    }

    @Test
    @DisplayName("Handle missing patient data gracefully")
    void testHandlingMissingPatientData() {
        Executable executable = () -> riskScoringModule.calculateRiskScore(missingDataPatient);

        Exception exception = assertThrows(IllegalArgumentException.class, executable);
        assertTrue(exception.getMessage().toLowerCase().contains("missing"));
    }

    @Test
    @DisplayName("Handle invalid patient data with proper exceptions")
    void testHandlingInvalidPatientData() {
        Executable executable = () -> riskScoringModule.calculateRiskScore(invalidDataPatient);

        Exception exception = assertThrows(IllegalArgumentException.class, executable);
        assertTrue(exception.getMessage().toLowerCase().contains("invalid"));
    }

    @Test
    @DisplayName("Predictive model integration for risk score enhancement")
    void testPredictiveModelIntegration() {
        when(predictiveModel.predictRiskScore(any(PatientData.class))).thenReturn(42.0);

        double score = riskScoringModule.calculateRiskScoreWithModel(validPatientLowRisk);

        assertEquals(42.0, score);
        verify(predictiveModel, times(1)).predictRiskScore(validPatientLowRisk);
    }

    @Test
    @DisplayName("Performance benchmark: risk score calculation under 50 ms")
    void testPerformanceCalculationSpeed() {
        PatientData largeSamplePatient = PatientData.builder()
                .age(50)
                .cholesterol(200)
                .bloodPressure(120)
                .smokingStatus(true)
                .diabetes(true)
                .build();

        assertTimeoutPreemptively(Duration.of(50, ChronoUnit.MILLIS), () -> {
            for (int i = 0; i < 1000; i++) {
                riskScoringModule.calculateRiskScore(largeSamplePatient);
            }
        });
    }

    @Test
    @DisplayName("Thread safety for concurrent risk score calculations")
    void testThreadSafetyForConcurrentCalculations() throws InterruptedException {
        int concurrencyLevel = 20;
        ExecutorService executor = Executors.newFixedThreadPool(concurrencyLevel);
        CountDownLatch latch = new CountDownLatch(concurrencyLevel);
        PatientData patient = validPatientMidRisk;

        Runnable task = () -> {
            try {
                double score = riskScoringModule.calculateRiskScore(patient);
                assertTrue(score >= 0);
            } finally {
                latch.countDown();
            }
        };

        IntStream.range(0, concurrencyLevel).forEach(i -> executor.submit(task));

        boolean completed = latch.await(5, TimeUnit.SECONDS);
        executor.shutdownNow();
        assertTrue(completed, "All concurrent tasks should complete within timeout");
    }

}
```
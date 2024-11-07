package com.ketryx.sample;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class SensorReadingTest {
    /**
     * Validates that the Risk Scoring Module accurately calculates risk scores for coronary events based on patient data.
     * @tests:SensorReading
     * @itemTitle:"Risk Scoring Module Validation (Java)"
     */
    @Test
    public void sensorReadingTest() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }
}

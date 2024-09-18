package com.ketryx.sample;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class SensorReadingTest {
    /**
     * Tests that sensor is read correctly.
     * @tests:KXITM0MT1FR2EN79V7S4WFM1BR082MA
     * @itemTitle:"Test Sensor Reading (Java)"
     */
    @Test
    public void sensorReadingTest() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }
}

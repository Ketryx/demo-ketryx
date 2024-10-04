package com.ketryx.sample;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class SensorReadingTest {
    /**
     * Tests that sensor is read correctly.
     * @tests:SensorReading
     * @itemTitle:"Test Sensor Reading (Java)"
     */
    @Test
    public void sensorReadingTest() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }

    // @itemTitle:"Test Peripheral Reading (Java)" @tests:KD-32
    // @tests:KD-8
    // @tests:KD-33
    @Test
    @DisplayName("Should return")
    void createPeripheral() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }

    /**
     * @itemTitle:"Test Mouse Reading (Java)" @tests:KD-32
     * @tests:KD-8
     * @tests:KD-33
     */
    @Test
    @DisplayName("Should return")
    void createMouse() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }
}

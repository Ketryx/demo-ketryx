package com.ketryx.sample;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class SensorReadingTest {
    /**
     * Tests that sensor is read correctly.
     * @tests:SensorReadingDS
     * @itemTitle:"Test Sensor Reading (Java)"
     */
    @Test
    public void sensorReadingTest() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }

    // @itemTitle:"Test Peripheral Reading (Java)"
    // @tests:KXITM1X5BNE4ACT9T6A8MC2ACQA6NPD
    @DisplayName("Should return")
    @Test
    void createPeripheral() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }

    // @tests:KD-1
    @Test
    void createMouse() {
        assertEquals(3, SensorReading.readSensor(1, 2));
    }
}

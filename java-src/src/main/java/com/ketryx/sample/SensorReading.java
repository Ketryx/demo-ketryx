package com.ketryx.sample;

/**
 * Utility class to read sensor.
 *
 * @itemId:SensorReading
 * @itemTitle:"Sensor Reading"
 * @itemHasParent:spec-sensor-module
 * @itemFulfills:CS-1
 */
public class SensorReading {
    public static int readSensor(int a, int b) {
        return a + b;
    }
}

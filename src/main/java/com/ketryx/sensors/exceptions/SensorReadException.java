```java
package com.ketryx.sensors.exceptions;

public class SensorReadException extends Exception {

    public SensorReadException(String message) {
        super(message);
    }

    public SensorReadException(String message, Throwable cause) {
        super(message, cause);
    }

    public SensorReadException(Throwable cause) {
        super(cause);
    }
}

class SensorTimeoutException extends SensorReadException {

    public SensorTimeoutException(String sensorName, long timeoutMillis) {
        super(String.format("Sensor '%s' read timed out after %d ms.", sensorName, timeoutMillis));
    }

    public SensorTimeoutException(String sensorName, long timeoutMillis, Throwable cause) {
        super(String.format("Sensor '%s' read timed out after %d ms.", sensorName, timeoutMillis), cause);
    }
}

class InvalidSensorDataException extends SensorReadException {

    public InvalidSensorDataException(String sensorName, String invalidData) {
        super(String.format("Sensor '%s' returned invalid data: %s", sensorName, invalidData));
    }

    public InvalidSensorDataException(String sensorName, String invalidData, Throwable cause) {
        super(String.format("Sensor '%s' returned invalid data: %s", sensorName, invalidData), cause);
    }
}

class SensorNotAvailableException extends SensorReadException {

    public SensorNotAvailableException(String sensorName) {
        super(String.format("Sensor '%s' is not available.", sensorName));
    }

    public SensorNotAvailableException(String sensorName, Throwable cause) {
        super(String.format("Sensor '%s' is not available.", sensorName), cause);
    }
}
```
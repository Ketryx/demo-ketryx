# Sensor Reading Java API

## Overview

The `SensorReading` Java utility provides a standardized way to access, interpret, and manipulate sensor data for IoT and industrial applications. This class is designed to facilitate robust, real-time data ingestion and processing, particularly in systems requiring high sensitivity to environmental and operational anomalies.

## Purpose

- Enable reliable retrieval of raw and processed sensor data.
- Support integration with advanced detection modules.
- Ensure thread-safe operations within concurrent environments.
- Fulfill anomaly detection sensitivity requirements by providing precise sensor data handling.

---

## Class: `SensorReading`

### Package

```java
com.example.sensor;
```

### Description

`SensorReading` encapsulates methods to read sensor data, convert it to meaningful units, and interact with the Blockage Detection Module (`KXREC0DJ3A4TXYE90Y8V5V167X934SB`) for monitoring purposes. It is also compliant with the anomaly detection sensitivity requirements detailed in `KXREC50ZS9YFJP789V9G2FPYTMT1KJK`.

---

## Public Methods

### 1. `public SensorReading(int sensorId)`

**Constructor**  
Creates a new SensorReading instance for the specified sensor.

- **Parameters:**  
  `sensorId` - Unique identifier for the sensor.

---

### 2. `public double readRawValue() throws SensorReadException`

Reads the raw sensor value directly from hardware.

- **Returns:**  
  The raw sensor reading as a double.

- **Throws:**  
  `SensorReadException` if the sensor data cannot be retrieved.

---

### 3. `public double readProcessedValue() throws SensorReadException`

Returns a processed and calibrated sensor value adjusted for environmental factors.

- **Returns:**  
  Calibrated sensor reading.

- **Throws:**  
  `SensorReadException` in case of errors in data processing.

---

### 4. `public SensorStatus getStatus()`

Obtains the current status of the sensor.

- **Returns:**  
  A `SensorStatus` enum indicating sensor health (`OK`, `WARNING`, `ERROR`).

---

### 5. `public void addDataListener(SensorDataListener listener)`

Registers a listener to receive real-time sensor data updates.

- **Parameters:**  
  `listener` - Instance implementing `SensorDataListener` interface.

---

### 6. `public void removeDataListener(SensorDataListener listener)`

Removes a previously registered sensor data listener.

---

### 7. `public synchronized void calibrate(double calibrationFactor)`

Applies a calibration factor to adjust the sensor readings.

- **Parameters:**  
  `calibrationFactor` - Multiplier to calibrate raw data.

---

## Usage Examples

### Basic Sensor Reading

```java
SensorReading sensor = new SensorReading(101);
try {
    double rawValue = sensor.readRawValue();
    System.out.println("Raw Sensor Value: " + rawValue);
} catch (SensorReadException e) {
    System.err.println("Failed to read sensor: " + e.getMessage());
}
```

### Processed Data with Calibration

```java
SensorReading sensor = new SensorReading(102);
sensor.calibrate(1.05);

try {
    double calibratedValue = sensor.readProcessedValue();
    System.out.println("Calibrated Value: " + calibratedValue);
} catch (SensorReadException e) {
    e.printStackTrace();
}
```

### Integrating with Blockage Detection Module

```java
SensorReading sensor = new SensorReading(110);
BlockageDetectionModule blockageModule = new BlockageDetectionModule("KXREC0DJ3A4TXYE90Y8V5V167X934SB");

sensor.addDataListener(data -> {
    blockageModule.processSensorData(data);
});
```

---

## Error Handling

- Always catch `SensorReadException` when performing read operations.
- Log error details and perform retries if needed.
- Use `getStatus()` to proactively monitor sensor health before data retrieval.
- Avoid ignoring exceptions to maintain system reliability.

---

## Thread Safety

- The class is designed with thread-safe methods, including `synchronized` on calibration operations.
- Listener registration/removal is thread safe.
- Concurrent calls to read methods are supported and recommended for performance optimization.

---

## Integration Notes

- **Blockage Detection Module (KXREC0DJ3A4TXYE90Y8V5V167X934SB):**  
  `SensorReading` works seamlessly to feed sensor data to the blockage detection pipeline via event listeners or direct calls.

- **Anomaly Detection Sensitivity (KXREC50ZS9YFJP789V9G2FPYTMT1KJK):**  
  Sensor readings meet required precision levels and data consistency standards mandated by the sensitivity specification.

---

## Testing and Validation

The reliability of `SensorReading` has been validated through comprehensive unit and integration tests, including:

- **Validation Test: KXREC4E99SY0G1E9MB8ZX2ETZSKN5K3**  
  This test covers simulated sensor inputs under normal and exceptional conditions, verifying accuracy, thread safety, and error handling.

Test suites are executed as part of the continuous integration pipeline, utilizing JUnit and Mockito frameworks to ensure quality and stability.

---

For further assistance or to report issues, please contact the development team at `support@sensordev.example.com`.
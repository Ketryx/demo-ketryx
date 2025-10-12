```java
package com.ketryx.sensors;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.*;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Utility class for reading sensor data from various sources.
 * Provides thread-safe reading operations with validation, timeout handling,
 * custom exception management, and logging for troubleshooting.
 */
public final class SensorReading {

    private static final Logger LOGGER = Logger.getLogger(SensorReading.class.getName());
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    private SensorReading() {
        // Utility class, prevent instantiation
    }

    /**
     * Enumeration of supported sensor types.
     */
    public enum SensorType {
        TEMPERATURE, HUMIDITY, PRESSURE, LIGHT, MOTION
    }

    /**
     * Reads sensor data from an InputStream source.
     *
     * @param sensorType the type of sensor
     * @param inputStream the input stream to read data from
     * @param timeout the maximum duration to wait for reading
     * @return validated sensor data as a double
     * @throws SensorReadException if reading or validation fails or timeout occurs
     */
    public static double readFromInputStream(final SensorType sensorType,
                                             final InputStream inputStream,
                                             final Duration timeout) throws SensorReadException {
        Objects.requireNonNull(sensorType, "sensorType must not be null");
        Objects.requireNonNull(inputStream, "inputStream must not be null");
        Objects.requireNonNull(timeout, "timeout must not be null");

        Callable<Double> task = () -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
                String line = reader.readLine();
                if (line == null) {
                    throw new SensorReadException("No data received from sensor");
                }
                double value = parseSensorValue(line);
                validate(sensorType, value);
                return value;
            } catch (IOException e) {
                LOGGER.log(Level.SEVERE, "I/O error reading sensor data", e);
                throw new SensorReadException("I/O error reading sensor data", e);
            }
        };

        return executeWithTimeout(task, timeout);
    }

    /**
     * Reads sensor data from a String source.
     *
     * @param sensorType the type of sensor
     * @param rawData raw sensor data as string
     * @return validated sensor data as a double
     * @throws SensorReadException if validation fails or data is invalid
     */
    public static double readFromString(final SensorType sensorType, final String rawData) throws SensorReadException {
        Objects.requireNonNull(sensorType, "sensorType must not be null");
        Objects.requireNonNull(rawData, "rawData must not be null");

        double value = parseSensorValue(rawData);
        validate(sensorType, value);
        return value;
    }

    /**
     * Reads sensor data from a callable supplier.
     * This method allows custom data fetching mechanisms with timeout and thread safety.
     *
     * @param sensorType the type of sensor
     * @param supplier the callable that fetches raw sensor data string
     * @param timeout the maximum duration to wait for reading
     * @return validated sensor data as a double
     * @throws SensorReadException if reading or validation fails or timeout occurs
     */
    public static double readFromSupplier(final SensorType sensorType,
                                          final Callable<String> supplier,
                                          final Duration timeout) throws SensorReadException {
        Objects.requireNonNull(sensorType, "sensorType must not be null");
        Objects.requireNonNull(supplier, "supplier must not be null");
        Objects.requireNonNull(timeout, "timeout must not be null");

        Callable<Double> task = () -> {
            try {
                String rawData = supplier.call();
                if (rawData == null || rawData.isEmpty()) {
                    throw new SensorReadException("Supplier returned no data");
                }
                double value = parseSensorValue(rawData);
                validate(sensorType, value);
                return value;
            } catch (Exception e) {
                LOGGER.log(Level.SEVERE, "Error fetching sensor data from supplier", e);
                throw new SensorReadException("Error fetching sensor data from supplier", e);
            }
        };

        return executeWithTimeout(task, timeout);
    }

    /**
     * Validates the sensor data value according to sensor type-specific constraints.
     *
     * @param sensorType the type of sensor
     * @param value the sensor data value
     * @throws SensorReadException if validation fails
     */
    private static void validate(final SensorType sensorType, final double value) throws SensorReadException {
        switch (sensorType) {
            case TEMPERATURE:
                if (value < -100 || value > 150) {
                    throw new SensorReadException("Temperature value out of valid range: " + value);
                }
                break;
            case HUMIDITY:
                if (value < 0 || value > 100) {
                    throw new SensorReadException("Humidity value out of valid range: " + value);
                }
                break;
            case PRESSURE:
                if (value < 300 || value > 1100) {
                    throw new SensorReadException("Pressure value out of valid range: " + value);
                }
                break;
            case LIGHT:
                if (value < 0) {
                    throw new SensorReadException("Light value cannot be negative: " + value);
                }
                break;
            case MOTION:
                if (value != 0 && value != 1) {
                    throw new SensorReadException("Motion sensor value must be 0 or 1: " + value);
                }
                break;
            default:
                throw new SensorReadException("Unknown sensor type: " + sensorType);
        }
    }

    /**
     * Parses the raw sensor data string to a double value.
     *
     * @param rawData the raw sensor data string
     * @return the parsed double value
     * @throws SensorReadException if raw data is not a valid double number
     */
    private static double parseSensorValue(final String rawData) throws SensorReadException {
        try {
            return Double.parseDouble(rawData.trim());
        } catch (NumberFormatException e) {
            LOGGER.log(Level.WARNING, "Invalid sensor data format: " + rawData, e);
            throw new SensorReadException("Invalid sensor data format: " + rawData, e);
        }
    }

    /**
     * Executes a callable task with timeout, handling interruption, cancellation, and timeout exceptions.
     *
     * @param task the callable task returning a Double result
     * @param timeout the maximum duration to wait
     * @return the result of the task if successful within timeout
     * @throws SensorReadException if the task fails or times out
     */
    private static double executeWithTimeout(final Callable<Double> task, final Duration timeout) throws SensorReadException {
        Future<Double> future = EXECUTOR.submit(task);
        try {
            return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            LOGGER.log(Level.SEVERE, "Sensor read operation timed out", e);
            throw new SensorReadException("Sensor read operation timed out after " + timeout.toMillis() + "ms", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            LOGGER.log(Level.SEVERE, "Sensor read operation interrupted", e);
            throw new SensorReadException("Sensor read operation interrupted", e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof SensorReadException) {
                throw (SensorReadException) cause;
            }
            LOGGER.log(Level.SEVERE, "Sensor read execution failed", e);
            throw new SensorReadException("Sensor read execution failed", e);
        }
    }

    /**
     * Custom exception for sensor reading errors.
     */
    public static class SensorReadException extends Exception {

        public SensorReadException(String message) {
            super(message);
        }

        public SensorReadException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
```
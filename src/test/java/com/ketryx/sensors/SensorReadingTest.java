```java
package com.ketryx.sensors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Duration;
import java.util.concurrent.*;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class SensorReadingTest {

    interface Sensor {
        String getType();
        String readData() throws SensorUnavailableException;
    }

    static class SensorUnavailableException extends Exception {
        public SensorUnavailableException(String message) { super(message); }
    }

    static class SensorReading {
        private final Sensor sensor;
        private final Duration timeout;

        public SensorReading(Sensor sensor, Duration timeout) {
            this.sensor = sensor;
            this.timeout = timeout;
        }

        public String read() throws SensorUnavailableException, TimeoutException {
            ExecutorService executor = Executors.newSingleThreadExecutor();
            Future<String> future = executor.submit(() -> sensor.readData());
            try {
                return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                future.cancel(true);
                throw new TimeoutException("Reading sensor timed out");
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("Interrupted during sensor read");
            } catch (ExecutionException ee) {
                if (ee.getCause() instanceof SensorUnavailableException) {
                    throw (SensorUnavailableException) ee.getCause();
                }
                throw new RuntimeException("Unexpected exception reading sensor", ee);
            } finally {
                executor.shutdownNow();
            }
        }

        public String getSensorType() {
            return sensor.getType();
        }
    }

    private Sensor sensorMock;
    private SensorReading sensorReading;
    private final Duration timeout = Duration.ofMillis(200);

    @BeforeEach
    void setup() {
        sensorMock = mock(Sensor.class);
        sensorReading = new SensorReading(sensorMock, timeout);
    }

    @Test
    void testSuccessfulSensorDataReading() throws Exception {
        when(sensorMock.readData()).thenReturn("25.4°C");
        when(sensorMock.getType()).thenReturn("Temperature");

        String data = sensorReading.read();

        assertEquals("25.4°C", data);
        assertEquals("Temperature", sensorReading.getSensorType());
        verify(sensorMock).readData();
        verify(sensorMock).getType();
    }

    @Test
    void testTimeoutHandling() throws Exception {
        when(sensorMock.readData()).thenAnswer(invocation -> {
            Thread.sleep(timeout.toMillis() + 100);
            return "DelayedData";
        });

        TimeoutException ex = assertThrows(TimeoutException.class, () -> sensorReading.read());
        assertEquals("Reading sensor timed out", ex.getMessage());
        verify(sensorMock).readData();
    }

    @Test
    void testInvalidDataDetection() throws Exception {
        // Let's assume invalid data is empty string or null
        when(sensorMock.readData()).thenReturn("");

        String data = sensorReading.read();
        assertTrue(data.isEmpty(), "Data should be empty (invalid)");

        when(sensorMock.readData()).thenReturn(null);

        String nullData = sensorReading.read();
        assertNull(nullData, "Data should be null (invalid)");
    }

    @Test
    void testThreadSafetyWithConcurrentReads() throws Exception {
        when(sensorMock.readData()).thenReturn("42", "43", "44", "45", "46");
        int threadCount = 5;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CountDownLatch latch = new CountDownLatch(threadCount);

        ConcurrentLinkedQueue<String> results = new ConcurrentLinkedQueue<>();
        IntStream.range(0, threadCount).forEach(i -> executor.submit(() -> {
            try {
                results.add(sensorReading.read());
            } catch (Exception e) {
                results.add(e.getClass().getSimpleName());
            } finally {
                latch.countDown();
            }
        }));

        assertTrue(latch.await(1, TimeUnit.SECONDS), "All threads should complete");

        for (String result : results) {
            assertTrue(result.matches("\\d{2}"), "Result should be a two digit number string");
        }

        executor.shutdownNow();
        verify(sensorMock, times(threadCount)).readData();
    }

    @Test
    void testErrorHandlingForUnavailableSensors() throws Exception {
        when(sensorMock.readData()).thenThrow(new SensorUnavailableException("Sensor offline"));

        SensorUnavailableException ex = assertThrows(SensorUnavailableException.class, () -> sensorReading.read());
        assertEquals("Sensor offline", ex.getMessage());
        verify(sensorMock).readData();
    }

    @Test
    void testReadingFromDifferentSensorTypes() throws Exception {
        Sensor tempSensor = mock(Sensor.class);
        when(tempSensor.getType()).thenReturn("Temperature");
        when(tempSensor.readData()).thenReturn("21.8°C");

        Sensor pressureSensor = mock(Sensor.class);
        when(pressureSensor.getType()).thenReturn("Pressure");
        when(pressureSensor.readData()).thenReturn("1013hPa");

        SensorReading tempReading = new SensorReading(tempSensor, timeout);
        SensorReading pressureReading = new SensorReading(pressureSensor, timeout);

        assertEquals("Temperature", tempReading.getSensorType());
        assertEquals("21.8°C", tempReading.read());

        assertEquals("Pressure", pressureReading.getSensorType());
        assertEquals("1013hPa", pressureReading.read());

        verify(tempSensor).readData();
        verify(pressureSensor).readData();
    }
}
```
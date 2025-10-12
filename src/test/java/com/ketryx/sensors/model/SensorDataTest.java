```java
package com.ketryx.sensors.model;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;

class SensorDataTest {

    @Test
    void testObjectCreationWithValidData() {
        Instant timestamp = Instant.now();
        SensorData data = SensorData.builder()
                .id("sensor-01")
                .value(42.0)
                .timestamp(timestamp)
                .type("temperature")
                .build();

        assertEquals("sensor-01", data.getId());
        assertEquals(42.0, data.getValue());
        assertEquals(timestamp, data.getTimestamp());
        assertEquals("temperature", data.getType());
    }

    @Test
    void testValidationCatchesInvalidInputs() {
        Instant timestamp = Instant.now();

        assertThrows(NullPointerException.class, () ->
                SensorData.builder()
                        .id(null)
                        .value(10)
                        .timestamp(timestamp)
                        .type("humidity")
                        .build());

        assertThrows(IllegalArgumentException.class, () ->
                SensorData.builder()
                        .id("sensor-02")
                        .value(Double.NaN)
                        .timestamp(timestamp)
                        .type("humidity")
                        .build());

        assertThrows(NullPointerException.class, () ->
                SensorData.builder()
                        .id("sensor-02")
                        .value(10)
                        .timestamp(null)
                        .type("humidity")
                        .build());

        assertThrows(NullPointerException.class, () ->
                SensorData.builder()
                        .id("sensor-02")
                        .value(10)
                        .timestamp(timestamp)
                        .type(null)
                        .build());
    }

    @Test
    void testImmutability() throws NoSuchMethodException {
        // Assuming SensorData is immutable with no setters and final fields
        var cls = SensorData.class;
        var setters = cls.getDeclaredMethods();
        boolean hasSetters = false;
        for (var m : setters) {
            if (m.getName().startsWith("set")) {
                hasSetters = true;
                break;
            }
        }
        assertFalse(hasSetters, "SensorData should have no setters to enforce immutability");
    }

    @Test
    void testBuilderPatternWorksCorrectly() {
        Instant timestamp = Instant.now();
        SensorData.SensorDataBuilder builder = SensorData.builder();
        builder.id("sensor-03");
        builder.value(99.9);
        builder.timestamp(timestamp);
        builder.type("pressure");

        SensorData data = builder.build();

        assertEquals("sensor-03", data.getId());
        assertEquals(99.9, data.getValue());
        assertEquals(timestamp, data.getTimestamp());
        assertEquals("pressure", data.getType());
    }

    @Test
    void testJsonSerializationDeserialization() throws JsonProcessingException {
        ObjectMapper mapper = new ObjectMapper();

        Instant timestamp = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        SensorData original = SensorData.builder()
                .id("sensor-json")
                .value(123.45)
                .timestamp(timestamp)
                .type("luminosity")
                .build();

        String json = mapper.writeValueAsString(original);
        assertNotNull(json);
        assertTrue(json.contains("sensor-json"));

        SensorData fromJson = mapper.readValue(json, SensorData.class);
        assertEquals(original.getId(), fromJson.getId());
        assertEquals(original.getValue(), fromJson.getValue());
        assertEquals(original.getTimestamp(), fromJson.getTimestamp());
        assertEquals(original.getType(), fromJson.getType());
    }
}
```
```java
package com.ketryx.sensors.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.Objects;

public final class SensorData {

    private final Instant timestamp;
    private final double value;
    private final String sensorId;
    private final String unit;
    private final DataQuality dataQuality;

    private SensorData(Builder builder) {
        this.timestamp = Objects.requireNonNull(builder.timestamp, "timestamp must not be null");
        this.sensorId = Objects.requireNonNull(builder.sensorId, "sensorId must not be null");
        this.unit = Objects.requireNonNull(builder.unit, "unit must not be null");
        this.dataQuality = Objects.requireNonNull(builder.dataQuality, "dataQuality must not be null");
        this.value = builder.value;

        if (builder.value < 0 && !builder.allowNegativeValues) {
            throw new IllegalArgumentException("value must not be negative");
        }
    }

    @JsonCreator
    public SensorData(
            @JsonProperty("timestamp") Instant timestamp,
            @JsonProperty("value") double value,
            @JsonProperty("sensorId") String sensorId,
            @JsonProperty("unit") String unit,
            @JsonProperty("dataQuality") DataQuality dataQuality) {
        this.timestamp = Objects.requireNonNull(timestamp, "timestamp must not be null");
        this.sensorId = Objects.requireNonNull(sensorId, "sensorId must not be null");
        this.unit = Objects.requireNonNull(unit, "unit must not be null");
        this.dataQuality = Objects.requireNonNull(dataQuality, "dataQuality must not be null");
        this.value = value;
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public double getValue() {
        return value;
    }

    public String getSensorId() {
        return sensorId;
    }

    public String getUnit() {
        return unit;
    }

    public DataQuality getDataQuality() {
        return dataQuality;
    }

    public static Builder builder() {
        return new Builder();
    }

    public enum DataQuality {
        GOOD,
        BAD,
        UNCERTAIN
    }

    public static final class Builder {
        private Instant timestamp;
        private double value;
        private String sensorId;
        private String unit;
        private DataQuality dataQuality;
        private boolean allowNegativeValues = false;

        private Builder() {
        }

        public Builder timestamp(Instant timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public Builder value(double value) {
            this.value = value;
            return this;
        }

        public Builder sensorId(String sensorId) {
            this.sensorId = sensorId;
            return this;
        }

        public Builder unit(String unit) {
            this.unit = unit;
            return this;
        }

        public Builder dataQuality(DataQuality dataQuality) {
            this.dataQuality = dataQuality;
            return this;
        }

        /**
         * Allows negative sensor values if set to true.
         */
        public Builder allowNegativeValues(boolean allow) {
            this.allowNegativeValues = allow;
            return this;
        }

        public SensorData build() {
            return new SensorData(this);
        }
    }
}
```
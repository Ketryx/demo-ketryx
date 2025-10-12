```java
package com.cardiac.risk.models;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.*;

class CoronaryEventRiskTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void testDataValidation_constraints() {
        // Assuming validation annotations exist, simulate validation manually
        // For demonstration, we check null and invalid enum behavior here

        // id should not be null or empty if applicable
        assertThatCode(() -> new CoronaryEventRisk(null, 55, Gender.MALE, 1.5))
                .doesNotThrowAnyException();

        // age boundary conditions (assuming age must be between 0 and 120)
        CoronaryEventRisk lowAge = new CoronaryEventRisk("id1", 0, Gender.FEMALE, 2.3);
        CoronaryEventRisk highAge = new CoronaryEventRisk("id2", 120, Gender.MALE, 4.1);
        assertThat(lowAge.getAge()).isBetween(0, 120);
        assertThat(highAge.getAge()).isBetween(0, 120);

        // riskScore non-negative
        CoronaryEventRisk zeroRisk = new CoronaryEventRisk("id3", 50, Gender.FEMALE, 0.0);
        CoronaryEventRisk positiveRisk = new CoronaryEventRisk("id4", 50, Gender.MALE, 10.5);
        assertThat(zeroRisk.getRiskScore()).isGreaterThanOrEqualTo(0);
        assertThat(positiveRisk.getRiskScore()).isGreaterThan(0);
    }

    @Test
    void testEnum_handling() {
        // Validate enum values
        for (Gender gender : Gender.values()) {
            assertThat(gender.name()).isIn("MALE", "FEMALE", "OTHER");
        }

        // Check valueOf and fromString safety
        assertThat(Gender.valueOf("MALE")).isEqualTo(Gender.MALE);
        assertThatExceptionOfType(IllegalArgumentException.class)
                .isThrownBy(() -> Gender.valueOf("INVALID"));

        // Null safety test should raise NPE for valueOf
        assertThatNullPointerException()
                .isThrownBy(() -> Gender.valueOf(null));
    }

    @Test
    void testSerialization_deserialization() throws JsonProcessingException {
        CoronaryEventRisk risk = new CoronaryEventRisk("risk123", 65, Gender.MALE, 3.14);
        String json = mapper.writeValueAsString(risk);
        assertThat(json).contains("risk123", "65", "MALE", "3.14");

        CoronaryEventRisk deserialized = mapper.readValue(json, CoronaryEventRisk.class);
        assertThat(deserialized).isEqualToComparingFieldByField(risk);
    }

    @Test
    void testEqualsAndHashCode_contract() {
        CoronaryEventRisk risk1 = new CoronaryEventRisk("idA", 50, Gender.FEMALE, 1.0);
        CoronaryEventRisk risk2 = new CoronaryEventRisk("idA", 50, Gender.FEMALE, 1.0);
        CoronaryEventRisk risk3 = new CoronaryEventRisk("idB", 60, Gender.MALE, 2.0);

        // Reflexive
        assertThat(risk1).isEqualTo(risk1);
        // Symmetric
        assertThat(risk1).isEqualTo(risk2);
        assertThat(risk2).isEqualTo(risk1);
        // Transitive
        CoronaryEventRisk risk2Copy = new CoronaryEventRisk("idA", 50, Gender.FEMALE, 1.0);
        assertThat(risk1).isEqualTo(risk2);
        assertThat(risk2).isEqualTo(risk2Copy);
        assertThat(risk1).isEqualTo(risk2Copy);
        // Consistent
        assertThat(risk1).isEqualTo(risk2);
        assertThat(risk1).hasSameHashCodeAs(risk2);
        // Null
        assertThat(risk1).isNotEqualTo(null);
        // Different instances
        assertThat(risk1).isNotEqualTo(risk3);

        // HashCode difference
        assertThat(risk1.hashCode()).isNotEqualTo(risk3.hashCode());
    }

    @Test
    void testImmutability() throws NoSuchFieldException {
        // Check all fields are final
        var clazz = CoronaryEventRisk.class;
        var fields = clazz.getDeclaredFields();
        for (var field : fields) {
            assertThat(java.lang.reflect.Modifier.isFinal(field.getModifiers()))
                    .as("Field %s is final", field.getName()).isTrue();
        }
    }

    @Test
    void testEdgeCases_forFields() {
        // Test age edge values
        assertThatCode(() -> new CoronaryEventRisk("e1", 0, Gender.OTHER, 0.0)).doesNotThrowAnyException();
        assertThatCode(() -> new CoronaryEventRisk("e2", 120, Gender.MALE, Double.MAX_VALUE)).doesNotThrowAnyException();
        assertThatCode(() -> new CoronaryEventRisk("e3", 25, Gender.FEMALE, Double.MIN_VALUE)).doesNotThrowAnyException();

        // Very large risk score
        CoronaryEventRisk hugeRisk = new CoronaryEventRisk("huge", 40, Gender.MALE, 1e9);
        assertThat(hugeRisk.getRiskScore()).isEqualTo(1e9);

        // Null id allowed or not? Assuming allowed, test with empty string
        CoronaryEventRisk emptyId = new CoronaryEventRisk("", 30, Gender.FEMALE, 0.5);
        assertThat(emptyId.getId()).isEmpty();
    }
}
```
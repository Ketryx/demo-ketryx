```java
package com.cardiac.risk.model;

import lombok.*;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class RiskScore {

    public enum SeverityLevel {
        LOW, MEDIUM, HIGH, CRITICAL
    }

    @PositiveOrZero
    private double scoreValue;

    @NotNull
    private SeverityLevel severityLevel;

    @NotNull
    @Singular
    @Size(min = 1)
    private List<@NotBlank String> contributingFactors;

    @NotNull
    private Instant calculationTimestamp;

    @NotBlank
    @Pattern(regexp = "^[a-fA-F0-9]{32}$", message = "Patient identifier must be a 32-character hex string (anonymized)")
    private String patientIdentifier;

    @DecimalMin(value = "0.0")
    @DecimalMax(value = "1.0")
    private double confidenceLevel;

    @NotNull
    @Singular
    private List<@NotBlank String> supportingEvidenceReferences;
}
```
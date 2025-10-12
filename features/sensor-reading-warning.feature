```gherkin
Feature: Sensor Reading Warnings
  As a monitoring system
  I want to trigger warnings when sensor readings violate thresholds or are outdated
  So that clinicians can be promptly notified of critical conditions

  @KXREC40QRT3EG9D8YATEJR64B4KXYVC
  Scenario: Sensor reading exceeds upper limit triggers warning
    Given a sensor with an upper limit of 100 units
    When the sensor reports a reading of 105 units
    Then a warning indicating "Reading exceeds upper limit" is triggered

  @KXREC40QRT3EG9D8YATEJR64B4KXYVC
  Scenario: Sensor reading below lower limit triggers warning
    Given a sensor with a lower limit of 20 units
    When the sensor reports a reading of 15 units
    Then a warning indicating "Reading below lower limit" is triggered

  @KXREC4X6HWMKKC594HBJDNACSMB2JC3
  Scenario: Outdated sensor reading triggers warning
    Given a sensor reading timestamped 2 hours ago
    And the acceptable reading freshness is 30 minutes
    When the system evaluates the reading
    Then a warning indicating "Sensor reading is outdated" is triggered

  @KXREC4X6HWMKKC594HBJDNACSMB2JC3
  Scenario: Multiple simultaneous threshold violations trigger multiple warnings
    Given a sensor with a lower limit of 20 units and upper limit of 100 units
    And the acceptable reading freshness is 30 minutes
    When the sensor reports a reading of 105 units timestamped 2 hours ago
    Then a warning indicating "Reading exceeds upper limit" is triggered
    And a warning indicating "Sensor reading is outdated" is triggered

  Scenario: Warning notification is delivered to clinician dashboard
    Given one or more warnings have been triggered for a sensor
    When the system sends notifications
    Then the clinician dashboard receives the warning notifications
```
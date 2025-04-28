Feature: Sensor module

  @tests:spec-sensor-reading-warning @tests:KD-1 @tests:KD-95
  Scenario: Test Sensor Reading Warning (Cucumber)
    Given Application is open
    When Data of 8 is entered
    And Form is submitted
    Then Sensor "<Sensors>" is not read
    And An error message is shown

    Examples:
      | Sensors     |
      | Primary     |
      | Secondary   |

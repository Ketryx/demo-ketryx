Feature: Sensor Warning module

  @tests:spec-sensor-reading-warning
  Scenario: Test Sensor Reading Warning (Cucumber)
    Given Application is open
    When Data of 8 is entered
    And Form is submitted
    Then Sensor is not read
    And An error message is shown

Feature: Data module

  @tests:spec-data
  Scenario: Test Model Drift
    Given Application is open
    When Data of 8 is entered
    And Form is submitted
    Then Sensor is not read
    And An error message is shown

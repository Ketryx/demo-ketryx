Feature: Sensor module

  @tests:spec-sensor-reading-warning
  Scenario: Test Sensor Reading Warning (Cucumber)
    Given Application is open
    When Data of 8 is entered
    And Form is submitted
    Then Sensor "<Fields>" is not read
    And An error message is shown

    Examples:
      | Fields      |
      | First Name  |
      | Last Name   |
      | Email       |

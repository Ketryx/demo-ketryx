Feature: Data module

  @tests:spec-data
  Scenario: Train-test contamination checks
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

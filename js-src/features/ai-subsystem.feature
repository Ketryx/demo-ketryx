Feature: AI subsystem

  @tests:spec-ai-subsystem @tests:CS-1 @tests:CS-2 @tests:CS-3
  Scenario: Test AI Subsystem
    Given Application is open
    When Data of 8 is entered
    And Form is submitted
    Then Sensor is not read
    And An error message is shown

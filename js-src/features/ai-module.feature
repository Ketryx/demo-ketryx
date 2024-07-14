Feature: AI module

  @tests:spec-ai-module
  Scenario: Test AI Module (Cucumber)
    Given Application is open
    When Data of 8 is entered
    And Form is submitted
    Then Sensor is not read
    And An error message is shown

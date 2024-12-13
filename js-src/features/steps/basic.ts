// Some basic Gherkin step definitions.
// These are only dummy implementations for demo purposes.

import { Given, Then, When } from '@cucumber/cucumber';

Given('Application is open',
  async function (this) {
  },
);

Given('Data of {int} is entered',
  async function (this, value: number) {
  },
);

When('Form is submitted',
  async function (this) {
  },
);

Then('Sensor {string} is not read',
  async function (string) {
  },
);

Then('Sensor is not read',
  async function (string) {
  },
);

Then('An error message is shown',
  async function (this) {
  },
);

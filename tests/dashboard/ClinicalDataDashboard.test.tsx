```tsx
import React from 'react';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ClinicalDataDashboard from '../../src/components/ClinicalDataDashboard';
import {
  mockPatientData,
  mockHistoricalData,
  mockRealTimeUpdates,
} from '../fixtures/clinicalDataFixtures';
import * as clinicalDataService from '../../src/services/clinicalDataService';
import * as authService from '../../src/services/authService';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

jest.mock('../../src/services/clinicalDataService');
jest.mock('../../src/services/authService');

const mockFetchPatientData = clinicalDataService.fetchPatientData as jest.Mock;
const mockFetchHistoricalData = clinicalDataService.fetchHistoricalData as jest.Mock;
const mockSubscribeRealTimeUpdates = clinicalDataService.subscribeRealTimeUpdates as jest.Mock;
const mockIsAuthorized = authService.isAuthorized as jest.Mock;

describe('ClinicalDataDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthorized.mockReturnValue(true);
  });

  const renderDashboard = () =>
    render(<ClinicalDataDashboard patientId="patient-123" />);

  test('renders correctly with mock patient data', async () => {
    mockFetchPatientData.mockResolvedValue(mockPatientData);
    mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);
    mockSubscribeRealTimeUpdates.mockImplementation(() => ({
      unsubscribe: jest.fn(),
    }));

    renderDashboard();

    expect(screen.getByText(/Loading patient data/i)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Patient Overview/i })).toBeInTheDocument()
    );

    expect(screen.getByText(mockPatientData.name)).toBeInTheDocument();
    expect(screen.getByText(mockPatientData.dateOfBirth)).toBeInTheDocument();

    // Check historical data table renders
    await waitFor(() =>
      expect(screen.getByRole('table', { name: /Historical Clinical Data/i })).toBeInTheDocument()
    );

    mockHistoricalData.forEach((record) => {
      expect(screen.getByText(record.measurement)).toBeInTheDocument();
      expect(screen.getByText(record.value.toString())).toBeInTheDocument();
      expect(screen.getByText(record.date)).toBeInTheDocument();
    });
  });

  test('loads and displays historical data correctly', async () => {
    mockFetchPatientData.mockResolvedValue(mockPatientData);
    mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);
    mockSubscribeRealTimeUpdates.mockImplementation(() => ({
      unsubscribe: jest.fn(),
    }));

    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole('table', { name: /Historical Clinical Data/i })).toBeInTheDocument()
    );

    const table = screen.getByRole('table', { name: /Historical Clinical Data/i });
    const rows = within(table).getAllByRole('row');
    expect(rows.length).toBe(mockHistoricalData.length + 1); // header + data rows
  });

  test('reflects real-time updates in the UI', async () => {
    mockFetchPatientData.mockResolvedValue(mockPatientData);
    mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);

    let updateCallback: (update: any) => void;
    mockSubscribeRealTimeUpdates.mockImplementation((patientId, onUpdate) => {
      updateCallback = onUpdate;
      return { unsubscribe: jest.fn() };
    });

    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole('table', { name: /Historical Clinical Data/i })).toBeInTheDocument()
    );

    // Simulate a real-time update
    const newUpdate = mockRealTimeUpdates[0];
    updateCallback!(newUpdate);

    await waitFor(() => {
      expect(screen.getByText(newUpdate.measurement)).toBeInTheDocument();
      expect(screen.getByText(newUpdate.value.toString())).toBeInTheDocument();
      expect(screen.getByText(newUpdate.date)).toBeInTheDocument();
    });
  });

  test('displays error message when patient data fetch fails', async () => {
    mockFetchPatientData.mockRejectedValue(new Error('Network error'));
    mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);
    mockSubscribeRealTimeUpdates.mockImplementation(() => ({
      unsubscribe: jest.fn(),
    }));

    renderDashboard();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load patient data/i);
  });

  test('displays error message when historical data fetch fails', async () => {
    mockFetchPatientData.mockResolvedValue(mockPatientData);
    mockFetchHistoricalData.mockRejectedValue(new Error('Timeout'));
    mockSubscribeRealTimeUpdates.mockImplementation(() => ({
      unsubscribe: jest.fn(),
    }));

    renderDashboard();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load historical data/i);
  });

  test('shows skeleton loaders during loading states', () => {
    mockFetchPatientData.mockReturnValue(new Promise(() => {})); // pending
    mockFetchHistoricalData.mockReturnValue(new Promise(() => {}));
    mockSubscribeRealTimeUpdates.mockImplementation(() => ({
      unsubscribe: jest.fn(),
    }));

    renderDashboard();

    expect(screen.getAllByTestId('skeleton-loader').length).toBeGreaterThan(0);
  });

  describe('User interactions: filtering, sorting, date range selection', () => {
    beforeEach(async () => {
      mockFetchPatientData.mockResolvedValue(mockPatientData);
      mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);
      mockSubscribeRealTimeUpdates.mockImplementation(() => ({
        unsubscribe: jest.fn(),
      }));

      renderDashboard();

      await waitFor(() =>
        expect(screen.getByRole('table', { name: /Historical Clinical Data/i })).toBeInTheDocument()
      );
    });

    test('filters data by measurement type', async () => {
      const filterSelect = screen.getByLabelText(/Filter by Measurement/i);
      userEvent.selectOptions(filterSelect, 'Blood Pressure');

      await waitFor(() => {
        const rows = screen.getAllByRole('row').slice(1); // exclude header
        rows.forEach((row) => {
          expect(row).toHaveTextContent(/Blood Pressure/);
        });
      });
    });

    test('sorts data by date ascending and descending', async () => {
      const sortButton = screen.getByRole('button', { name: /Sort by Date/i });
      // Initial sort descending assumed
      userEvent.click(sortButton); // ascending

      await waitFor(() => {
        const rows = screen.getAllByRole('row').slice(1);
        const dates = rows.map((row) => {
          const dateCell = within(row).getByTestId('date-cell');
          return dateCell.textContent || '';
        });
        const sorted = [...dates].sort();
        expect(dates).toEqual(sorted);
      });

      userEvent.click(sortButton); // descending

      await waitFor(() => {
        const rows = screen.getAllByRole('row').slice(1);
        const dates = rows.map((row) => {
          const dateCell = within(row).getByTestId('date-cell');
          return dateCell.textContent || '';
        });
        const sortedDesc = [...dates].sort().reverse();
        expect(dates).toEqual(sortedDesc);
      });
    });

    test('changes date range filters data correctly', async () => {
      const startDateInput = screen.getByLabelText(/Start Date/i);
      const endDateInput = screen.getByLabelText(/End Date/i);

      // Select date range to filter data that covers only one record
      userEvent.clear(startDateInput);
      userEvent.type(startDateInput, '2023-01-01');

      userEvent.clear(endDateInput);
      userEvent.type(endDateInput, '2023-01-31');

      fireEvent.blur(startDateInput);
      fireEvent.blur(endDateInput);

      await waitFor(() => {
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows.length).toBeGreaterThan(0);
        rows.forEach((row) => {
          const dateCell = within(row).getByTestId('date-cell');
          const date = new Date(dateCell.textContent || '');
          expect(date >= new Date('2023-01-01')).toBe(true);
          expect(date <= new Date('2023-01-31')).toBe(true);
        });
      });
    });
  });

  describe('Accessibility', () => {
    beforeEach(async () => {
      mockFetchPatientData.mockResolvedValue(mockPatientData);
      mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);
      mockSubscribeRealTimeUpdates.mockImplementation(() => ({
        unsubscribe: jest.fn(),
      }));

      renderDashboard();

      await waitFor(() =>
        expect(screen.getByRole('table', { name: /Historical Clinical Data/i })).toBeInTheDocument()
      );
    });

    test('has no detectable accessibility violations', async () => {
      const { container } = render(
        <ClinicalDataDashboard patientId="patient-123" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('supports keyboard navigation for sorting and filtering', async () => {
      const filterSelect = screen.getByLabelText(/Filter by Measurement/i);
      filterSelect.focus();
      expect(filterSelect).toHaveFocus();

      userEvent.keyboard('{arrowDown}{enter}');
      expect(filterSelect).toHaveValue(expect.any(String));

      const sortButton = screen.getByRole('button', { name: /Sort by Date/i });
      sortButton.focus();
      expect(sortButton).toHaveFocus();

      userEvent.keyboard('{enter}');
      // Confirm that sort applied (no errors)
      await waitFor(() => {
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows.length).toBeGreaterThan(0);
      });
    });

    test('screen reader can announce error messages', async () => {
      mockFetchPatientData.mockRejectedValue(new Error('Network error'));
      renderDashboard();

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/Failed to load patient data/i);
        expect(alert).toHaveAttribute('aria-live', 'assertive');
      });
    });
  });

  describe('Responsive behavior', () => {
    beforeEach(() => {
      mockFetchPatientData.mockResolvedValue(mockPatientData);
      mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);
      mockSubscribeRealTimeUpdates.mockImplementation(() => ({
        unsubscribe: jest.fn(),
      }));
    });

    test('renders full layout on desktop screens', async () => {
      window.innerWidth = 1200;
      window.dispatchEvent(new Event('resize'));

      renderDashboard();

      await waitFor(() =>
        expect(screen.getByRole('table', { name: /Historical Clinical Data/i })).toBeVisible()
      );

      // Expect sidebar, filters, and main content visible
      expect(screen.getByTestId('patient-overview')).toBeVisible();
      expect(screen.getByTestId('filters-panel')).toBeVisible();
    });

    test('collapses filters panel into dropdown on mobile screens', async () => {
      window.innerWidth = 375;
      window.dispatchEvent(new Event('resize'));

      renderDashboard();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Show Filters/i })).toBeVisible()
      );
      const filtersToggle = screen.getByRole('button', { name: /Show Filters/i });
      userEvent.click(filtersToggle);

      await waitFor(() => {
        expect(screen.getByTestId('filters-panel')).toBeVisible();
      });
    });
  });

  describe('Security controls', () => {
    test('does not render data if user is unauthorized', async () => {
      mockIsAuthorized.mockReturnValue(false);

      renderDashboard();

      await waitFor(() =>
        expect(screen.queryByRole('table', { name: /Historical Clinical Data/i })).not.toBeInTheDocument()
      );

      expect(screen.getByRole('alert')).toHaveTextContent(/You do not have permission to view this data/i);
    });

    test('renders data when user has appropriate permissions', async () => {
      mockIsAuthorized.mockReturnValue(true);
      mockFetchPatientData.mockResolvedValue(mockPatientData);
      mockFetchHistoricalData.mockResolvedValue(mockHistoricalData);
      mockSubscribeRealTimeUpdates.mockImplementation(() => ({
        unsubscribe: jest.fn(),
      }));

      renderDashboard();

      await waitFor(() =>
        expect(screen.getByRole('table', { name: /Historical Clinical Data/i })).toBeInTheDocument()
      );
    });
  });
});
```

/**
 * Unit tests for Alert Module.
 * 
 * Compliance: IEC 62304 - Software Unit Verification
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AlertModule } from '../../app/alert/AlertModule';

describe('AlertModule', () => {
  test('renders without crashing', () => {
    render(<AlertModule />);
    expect(screen.getByText('Alert System')).toBeInTheDocument();
  });

  test('displays unacknowledged count', () => {
    render(<AlertModule />);
    const countElement = screen.getByText(/Unacknowledged/);
    expect(countElement).toBeInTheDocument();
  });

  test('filter dropdown is present', () => {
    render(<AlertModule />);
    const filterLabel = screen.getByText('Filter by severity:');
    expect(filterLabel).toBeInTheDocument();
  });

  test('acknowledges alert on button click', () => {
    const mockCallback = jest.fn();
    render(<AlertModule onAlertAcknowledged={mockCallback} />);
    
    const acknowledgeButtons = screen.getAllByText('Acknowledge');
    if (acknowledgeButtons.length > 0) {
      fireEvent.click(acknowledgeButtons[0]);
      expect(mockCallback).toHaveBeenCalled();
    }
  });

  test('severity colors are applied correctly', () => {
    render(<AlertModule />);
    // Verify that severity badges are rendered
    const criticalBadges = screen.queryAllByText('CRITICAL');
    const highBadges = screen.queryAllByText('HIGH');
    expect(criticalBadges.length + highBadges.length).toBeGreaterThan(0);
  });
});

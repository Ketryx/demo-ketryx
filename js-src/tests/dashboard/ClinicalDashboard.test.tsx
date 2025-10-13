/**
 * Unit tests for Clinical Dashboard.
 * 
 * Compliance: IEC 62304 - Software Unit Verification
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClinicalDashboard } from '../../app/dashboard/ClinicalDashboard';

describe('ClinicalDashboard', () => {
  test('renders without crashing', () => {
    render(<ClinicalDashboard patientHash="test123" />);
    expect(screen.getByText('Loading patient data...')).toBeInTheDocument();
  });

  test('displays patient data after loading', async () => {
    render(<ClinicalDashboard patientHash="test123" />);
    
    await waitFor(() => {
      expect(screen.getByText('Clinical Data Dashboard')).toBeInTheDocument();
    });

    expect(screen.getByText('Patient Summary')).toBeInTheDocument();
  });

  test('displays risk score', async () => {
    render(<ClinicalDashboard patientHash="test123" />);
    
    await waitFor(() => {
      expect(screen.getByText('Current Risk Score')).toBeInTheDocument();
    });
  });

  test('displays risk history chart', async () => {
    render(<ClinicalDashboard patientHash="test123" />);
    
    await waitFor(() => {
      expect(screen.getByText('Risk Score History')).toBeInTheDocument();
    });
  });

  test('displays clinical metrics', async () => {
    render(<ClinicalDashboard patientHash="test123" />);
    
    await waitFor(() => {
      expect(screen.getByText('Calcium Score')).toBeInTheDocument();
      expect(screen.getByText('Max Stenosis')).toBeInTheDocument();
      expect(screen.getByText('Vessels Affected')).toBeInTheDocument();
    });
  });
});

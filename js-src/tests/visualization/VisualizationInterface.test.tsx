/**
 * Unit tests for Visualization Interface.
 * 
 * Compliance: IEC 62304 - Software Unit Verification
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VisualizationInterface } from '../../app/visualization/VisualizationInterface';

describe('VisualizationInterface', () => {
  test('renders without crashing', () => {
    render(<VisualizationInterface />);
    expect(screen.getByText('3D Cardiac Visualization')).toBeInTheDocument();
  });

  test('view mode buttons are present', () => {
    render(<VisualizationInterface />);
    expect(screen.getByText('3D View')).toBeInTheDocument();
    expect(screen.getByText('Slice View')).toBeInTheDocument();
  });

  test('switches between view modes', () => {
    render(<VisualizationInterface />);
    
    const sliceViewButton = screen.getByText('Slice View');
    fireEvent.click(sliceViewButton);
    
    // Button should be active after click
    expect(sliceViewButton).toHaveStyle({ backgroundColor: '#007bff' });
  });

  test('displays blockages panel', () => {
    render(<VisualizationInterface />);
    expect(screen.getByText('Detected Blockages')).toBeInTheDocument();
  });

  test('displays blockages when provided', () => {
    const mockBlockages = [
      {
        id: 'b1',
        vessel: 'LAD',
        location: 'proximal',
        stenosisPct: 75,
        severity: 'SEVERE',
        position: { x: 0, y: 0, z: 0 }
      }
    ];
    
    render(<VisualizationInterface blockages={mockBlockages} />);
    expect(screen.getByText('LAD')).toBeInTheDocument();
    expect(screen.getByText('75% stenosis')).toBeInTheDocument();
  });

  test('visualization controls are present', () => {
    render(<VisualizationInterface />);
    expect(screen.getByText('Visualization Controls')).toBeInTheDocument();
    expect(screen.getByText('Reset View')).toBeInTheDocument();
    expect(screen.getByText('Export Image')).toBeInTheDocument();
  });

  test('canvas element is rendered', () => {
    const { container } = render(<VisualizationInterface />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });
});

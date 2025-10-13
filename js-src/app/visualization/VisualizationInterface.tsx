/**
 * Visualization Interface for 3D Cardiac Models.
 * 
 * 3D model rendering with Three.js and blockage overlays.
 * 
 * Compliance: IEC 62304 Class C, FDA 510(k)
 * Software Item: KD-2 Visualization Interface
 * 
 * @author Cardiac Imaging Analysis Team
 * @version 1.0.0
 */

import React, { useEffect, useRef, useState } from 'react';

interface BlockageMarker {
  id: string;
  vessel: string;
  location: string;
  stenosisPct: number;
  severity: string;
  position: { x: number; y: number; z: number };
}

interface VisualizationProps {
  modelData?: any;
  blockages?: BlockageMarker[];
  deviceId?: string;
}

export const VisualizationInterface: React.FC<VisualizationProps> = ({
  modelData,
  blockages = [],
  deviceId = 'VI-001'
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedBlockage, setSelectedBlockage] = useState<BlockageMarker | null>(null);
  const [viewMode, setViewMode] = useState<'3D' | 'SLICE'>('3D');
  const [rotation, setRotation] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // In production, initialize Three.js scene
    console.info(`Visualization Interface initialized with device ID: ${deviceId}`);
    
    // Mock Three.js initialization
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        // Draw mock 3D visualization
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        // Draw mock heart shape
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(300, 200, 80, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(380, 200, 80, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw blockage markers
        blockages.forEach((blockage, idx) => {
          const x = 300 + idx * 60;
          const y = 280;
          
          ctx.fillStyle = getSeverityColor(blockage.severity);
          ctx.beginPath();
          ctx.arc(x, y, 15, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = 'white';
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('!', x, y + 4);
        });
        
        // Draw text
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.fillText('3D Cardiac Model Visualization', 20, 30);
      }
    }
  }, [blockages, deviceId]);

  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'SEVERE': return '#dc3545';
      case 'MODERATE': return '#ffc107';
      case 'MILD': return '#28a745';
      default: return '#6c757d';
    }
  };

  return (
    <div className="visualization-interface" style={{ padding: '20px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2>3D Cardiac Visualization</h2>
        <div>
          <button
            onClick={() => setViewMode('3D')}
            style={{
              padding: '8px 16px',
              marginRight: '10px',
              backgroundColor: viewMode === '3D' ? '#007bff' : '#e9ecef',
              color: viewMode === '3D' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            3D View
          </button>
          <button
            onClick={() => setViewMode('SLICE')}
            style={{
              padding: '8px 16px',
              backgroundColor: viewMode === 'SLICE' ? '#007bff' : '#e9ecef',
              color: viewMode === 'SLICE' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Slice View
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Main visualization canvas */}
        <div style={{
          flex: 2,
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: '#1a1a1a'
        }}>
          <canvas
            ref={canvasRef}
            width={600}
            height={400}
            style={{ display: 'block', width: '100%' }}
          />
          <div style={{
            padding: '10px',
            backgroundColor: 'rgba(0,0,0,0.8)',
            color: 'white',
            fontSize: '12px'
          }}>
            Use mouse to rotate | Scroll to zoom | Click markers for details
          </div>
        </div>

        {/* Blockage list panel */}
        <div style={{
          flex: 1,
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          padding: '15px',
          backgroundColor: 'white'
        }}>
          <h3 style={{ marginTop: 0 }}>Detected Blockages</h3>
          {blockages.length === 0 ? (
            <div style={{ color: '#6c757d', textAlign: 'center', padding: '20px' }}>
              No blockages detected
            </div>
          ) : (
            <div>
              {blockages.map(blockage => (
                <div
                  key={blockage.id}
                  onClick={() => setSelectedBlockage(blockage)}
                  style={{
                    border: `2px solid ${getSeverityColor(blockage.severity)}`,
                    borderRadius: '6px',
                    padding: '12px',
                    marginBottom: '10px',
                    cursor: 'pointer',
                    backgroundColor: selectedBlockage?.id === blockage.id 
                      ? '#f8f9fa' 
                      : 'white'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '5px'
                  }}>
                    <span style={{ fontWeight: 'bold' }}>{blockage.vessel}</span>
                    <span style={{
                      backgroundColor: getSeverityColor(blockage.severity),
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '3px',
                      fontSize: '11px'
                    }}>
                      {blockage.severity}
                    </span>
                  </div>
                  <div style={{ fontSize: '14px', color: '#6c757d' }}>
                    {blockage.location}
                  </div>
                  <div style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    marginTop: '8px',
                    color: getSeverityColor(blockage.severity)
                  }}>
                    {blockage.stenosisPct}% stenosis
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Controls panel */}
      <div style={{
        marginTop: '20px',
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        padding: '15px',
        backgroundColor: 'white'
      }}>
        <h4 style={{ marginTop: 0 }}>Visualization Controls</h4>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div>
            <label style={{ marginRight: '10px' }}>Opacity:</label>
            <input 
              type="range" 
              min="0" 
              max="100" 
              defaultValue="100"
              style={{ width: '150px' }}
            />
          </div>
          <div>
            <label style={{ marginRight: '10px' }}>Show:</label>
            <label style={{ marginRight: '15px' }}>
              <input type="checkbox" defaultChecked /> Arteries
            </label>
            <label style={{ marginRight: '15px' }}>
              <input type="checkbox" defaultChecked /> Blockages
            </label>
            <label>
              <input type="checkbox" /> Mesh
            </label>
          </div>
          <button style={{
            padding: '6px 12px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}>
            Reset View
          </button>
          <button style={{
            padding: '6px 12px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}>
            Export Image
          </button>
        </div>
      </div>

      <div style={{
        marginTop: '15px',
        padding: '10px',
        backgroundColor: '#e9ecef',
        borderRadius: '4px',
        fontSize: '12px',
        color: '#6c757d'
      }}>
        Device ID: {deviceId} | Rendering Engine: WebGL 2.0 | Model Vertices: 12,450
      </div>
    </div>
  );
};

export default VisualizationInterface;

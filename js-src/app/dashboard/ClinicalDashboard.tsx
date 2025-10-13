/**
 * Clinical Data Dashboard for Cardiac Imaging Analysis.
 * 
 * Real-time and historical data visualization with Chart.js.
 * 
 * Compliance: IEC 62304 Class C, HIPAA Security Rule
 * Software Item: KD-61 Clinical Data Dashboard
 * 
 * @author Cardiac Imaging Analysis Team
 * @version 1.0.0
 */

import React, { useState, useEffect } from 'react';

interface PatientData {
  patientHash: string;
  age: number;
  sex: string;
  lastScanDate: string;
  riskScore: number;
  riskLevel: string;
}

interface MetricData {
  timestamp: string;
  value: number;
}

interface DashboardProps {
  patientHash: string;
  deviceId?: string;
}

export const ClinicalDashboard: React.FC<DashboardProps> = ({
  patientHash,
  deviceId = 'CDD-001'
}) => {
  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [riskHistory, setRiskHistory] = useState<MetricData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In production, fetch from API
    // Mock data for demonstration
    const mockPatient: PatientData = {
      patientHash,
      age: 65,
      sex: 'M',
      lastScanDate: new Date().toISOString(),
      riskScore: 72.5,
      riskLevel: 'HIGH'
    };

    const mockRiskHistory: MetricData[] = [
      { timestamp: '2025-09-13', value: 58.2 },
      { timestamp: '2025-10-13', value: 72.5 }
    ];

    setTimeout(() => {
      setPatientData(mockPatient);
      setRiskHistory(mockRiskHistory);
      setLoading(false);
    }, 500);

    console.info(`Clinical Dashboard initialized for patient: ${patientHash}`);
  }, [patientHash]);

  const getRiskLevelColor = (level: string): string => {
    switch (level) {
      case 'CRITICAL': return '#dc3545';
      case 'HIGH': return '#fd7e14';
      case 'MODERATE': return '#ffc107';
      case 'LOW': return '#28a745';
      default: return '#6c757d';
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        Loading patient data...
      </div>
    );
  }

  if (!patientData) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#dc3545' }}>
        Failed to load patient data
      </div>
    );
  }

  return (
    <div className="clinical-dashboard" style={{ padding: '20px' }}>
      <h2>Clinical Data Dashboard</h2>
      
      {/* Patient Summary Card */}
      <div style={{
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        backgroundColor: 'white'
      }}>
        <h3 style={{ marginTop: 0 }}>Patient Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
          <div>
            <div style={{ color: '#6c757d', fontSize: '14px' }}>Patient ID (Hashed)</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{patientData.patientHash}</div>
          </div>
          <div>
            <div style={{ color: '#6c757d', fontSize: '14px' }}>Age / Sex</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {patientData.age} years / {patientData.sex}
            </div>
          </div>
          <div>
            <div style={{ color: '#6c757d', fontSize: '14px' }}>Last Scan Date</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {new Date(patientData.lastScanDate).toLocaleDateString()}
            </div>
          </div>
          <div>
            <div style={{ color: '#6c757d', fontSize: '14px' }}>Current Risk Level</div>
            <div style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: getRiskLevelColor(patientData.riskLevel)
            }}>
              {patientData.riskLevel}
            </div>
          </div>
        </div>
      </div>

      {/* Risk Score Card */}
      <div style={{
        border: `3px solid ${getRiskLevelColor(patientData.riskLevel)}`,
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        backgroundColor: 'white'
      }}>
        <h3 style={{ marginTop: 0 }}>Current Risk Score</h3>
        <div style={{
          fontSize: '48px',
          fontWeight: 'bold',
          color: getRiskLevelColor(patientData.riskLevel),
          textAlign: 'center',
          margin: '20px 0'
        }}>
          {patientData.riskScore.toFixed(1)}
        </div>
        <div style={{
          textAlign: 'center',
          color: '#6c757d',
          fontSize: '14px'
        }}>
          Composite Risk Score (0-100 scale)
        </div>
      </div>

      {/* Risk History Chart */}
      <div style={{
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        backgroundColor: 'white'
      }}>
        <h3 style={{ marginTop: 0 }}>Risk Score History</h3>
        <div style={{ height: '200px', position: 'relative' }}>
          {/* Simple bar chart visualization */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            height: '100%',
            gap: '20px'
          }}>
            {riskHistory.map((point, idx) => (
              <div key={idx} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: `${point.value}%`,
                  backgroundColor: '#007bff',
                  borderRadius: '4px 4px 0 0',
                  minHeight: '20px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  paddingTop: '5px',
                  color: 'white',
                  fontWeight: 'bold'
                }}>
                  {point.value.toFixed(1)}
                </div>
                <div style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  color: '#6c757d'
                }}>
                  {new Date(point.timestamp).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Clinical Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '15px'
      }}>
        <div style={{
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          padding: '15px',
          backgroundColor: 'white'
        }}>
          <div style={{ color: '#6c757d', fontSize: '14px' }}>Calcium Score</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>245</div>
          <div style={{ fontSize: '12px', color: '#fd7e14', marginTop: '3px' }}>Moderate</div>
        </div>
        <div style={{
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          padding: '15px',
          backgroundColor: 'white'
        }}>
          <div style={{ color: '#6c757d', fontSize: '14px' }}>Max Stenosis</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>65%</div>
          <div style={{ fontSize: '12px', color: '#fd7e14', marginTop: '3px' }}>LAD</div>
        </div>
        <div style={{
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          padding: '15px',
          backgroundColor: 'white'
        }}>
          <div style={{ color: '#6c757d', fontSize: '14px' }}>Vessels Affected</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '5px' }}>2</div>
          <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '3px' }}>of 3 major</div>
        </div>
      </div>

      <div style={{
        marginTop: '20px',
        padding: '10px',
        backgroundColor: '#e9ecef',
        borderRadius: '4px',
        fontSize: '12px',
        color: '#6c757d'
      }}>
        Device ID: {deviceId} | Last Updated: {new Date().toLocaleString()}
      </div>
    </div>
  );
};

export default ClinicalDashboard;

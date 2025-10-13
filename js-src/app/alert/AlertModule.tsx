/**
 * Alert Module for Cardiac Imaging Analysis.
 * 
 * Real-time warning system for anomalies and high-risk conditions.
 * 
 * Compliance: IEC 62304 Class C, HIPAA Security Rule
 * Software Item: KD-2 Alert Module
 * 
 * @author Cardiac Imaging Analysis Team
 * @version 1.0.0
 */

import React, { useState, useEffect } from 'react';

interface Alert {
  id: string;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  type: 'ANOMALY' | 'BLOCKAGE' | 'RISK_SCORE' | 'SYSTEM';
  message: string;
  timestamp: string;
  patientHash?: string;
  acknowledged: boolean;
}

interface AlertModuleProps {
  deviceId?: string;
  onAlertAcknowledged?: (alertId: string) => void;
}

export const AlertModule: React.FC<AlertModuleProps> = ({ 
  deviceId = 'AM-001',
  onAlertAcknowledged 
}) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState<string>('ALL');

  useEffect(() => {
    // In production, connect to WebSocket for real-time alerts
    // Mock alert generation for demonstration
    const mockAlerts: Alert[] = [
      {
        id: 'alert-001',
        severity: 'CRITICAL',
        type: 'BLOCKAGE',
        message: 'Severe stenosis detected in LAD (85% occlusion)',
        timestamp: new Date().toISOString(),
        patientHash: 'a1b2c3d4',
        acknowledged: false
      },
      {
        id: 'alert-002',
        severity: 'HIGH',
        type: 'RISK_SCORE',
        message: 'High risk score calculated (composite: 72.5)',
        timestamp: new Date().toISOString(),
        patientHash: 'a1b2c3d4',
        acknowledged: false
      }
    ];

    setAlerts(mockAlerts);

    // Setup WebSocket connection in production
    // const ws = new WebSocket('wss://cardiac-api.example.com/alerts');
    // ws.onmessage = (event) => {
    //   const alert = JSON.parse(event.data);
    //   setAlerts(prev => [alert, ...prev]);
    // };

    console.info(`Alert Module initialized with device ID: ${deviceId}`);
  }, [deviceId]);

  const handleAcknowledge = (alertId: string) => {
    setAlerts(prev => 
      prev.map(alert => 
        alert.id === alertId 
          ? { ...alert, acknowledged: true } 
          : alert
      )
    );

    if (onAlertAcknowledged) {
      onAlertAcknowledged(alertId);
    }

    console.info(`Alert acknowledged: ${alertId}`);
  };

  const getSeverityColor = (severity: Alert['severity']): string => {
    switch (severity) {
      case 'CRITICAL': return '#dc3545';
      case 'HIGH': return '#fd7e14';
      case 'MODERATE': return '#ffc107';
      case 'LOW': return '#28a745';
      default: return '#6c757d';
    }
  };

  const filteredAlerts = filter === 'ALL' 
    ? alerts 
    : alerts.filter(a => a.severity === filter);

  const unacknowledgedCount = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="alert-module" style={{ padding: '20px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2>Alert System</h2>
        <div style={{
          backgroundColor: unacknowledgedCount > 0 ? '#dc3545' : '#28a745',
          color: 'white',
          padding: '5px 15px',
          borderRadius: '20px',
          fontWeight: 'bold'
        }}>
          {unacknowledgedCount} Unacknowledged
        </div>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ marginRight: '10px' }}>Filter by severity:</label>
        <select 
          value={filter} 
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: '5px 10px' }}
        >
          <option value="ALL">All Alerts</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MODERATE">Moderate</option>
          <option value="LOW">Low</option>
        </select>
      </div>

      <div className="alerts-list">
        {filteredAlerts.length === 0 ? (
          <div style={{ 
            padding: '40px', 
            textAlign: 'center',
            color: '#6c757d' 
          }}>
            No alerts to display
          </div>
        ) : (
          filteredAlerts.map(alert => (
            <div
              key={alert.id}
              style={{
                border: `3px solid ${getSeverityColor(alert.severity)}`,
                borderRadius: '8px',
                padding: '15px',
                marginBottom: '15px',
                backgroundColor: alert.acknowledged ? '#f8f9fa' : 'white',
                opacity: alert.acknowledged ? 0.7 : 1
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '10px'
                  }}>
                    <span style={{
                      backgroundColor: getSeverityColor(alert.severity),
                      color: 'white',
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      marginRight: '10px'
                    }}>
                      {alert.severity}
                    </span>
                    <span style={{
                      backgroundColor: '#e9ecef',
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      {alert.type}
                    </span>
                  </div>
                  <div style={{ fontSize: '16px', marginBottom: '8px' }}>
                    {alert.message}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6c757d' }}>
                    {new Date(alert.timestamp).toLocaleString()}
                    {alert.patientHash && (
                      <span style={{ marginLeft: '15px' }}>
                        Patient: {alert.patientHash}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  {!alert.acknowledged && (
                    <button
                      onClick={() => handleAcknowledge(alert.id)}
                      style={{
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Acknowledge
                    </button>
                  )}
                  {alert.acknowledged && (
                    <span style={{ 
                      color: '#28a745',
                      fontWeight: 'bold' 
                    }}>
                      ✓ Acknowledged
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AlertModule;

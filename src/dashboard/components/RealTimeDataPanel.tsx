```tsx
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  FC,
  ReactNode,
} from "react";

type PatientData = {
  heartRate: number;
  bloodPressureSystolic: number;
  bloodPressureDiastolic: number;
  oxygenSaturation: number;
};

type ConnectionStatus = "connected" | "connecting" | "offline";

interface RealTimeDataPanelProps {
  refreshIntervalMs?: number; // default 5000 ms = 5 sec
  alertThresholds?: {
    heartRate?: { min?: number; max?: number };
    bloodPressureSystolic?: { min?: number; max?: number };
    bloodPressureDiastolic?: { min?: number; max?: number };
    oxygenSaturation?: { min?: number; max?: number };
  };
  // Simulate an external subscription function that accepts a callback to receive data
  subscribeToPatientData: (
    onData: (data: PatientData) => void,
    onError: (error: Error) => void
  ) => () => void; // returns unsubscribe function
}

const defaultAlertThresholds = {
  heartRate: { min: 50, max: 120 },
  bloodPressureSystolic: { min: 90, max: 140 },
  bloodPressureDiastolic: { min: 60, max: 90 },
  oxygenSaturation: { min: 90, max: 100 },
};

const CriticalAlert: FC<{ message: string }> = ({ message }) => (
  <div
    role="alert"
    aria-live="assertive"
    style={{
      backgroundColor: "#ff4d4d",
      color: "white",
      padding: "0.5rem 1rem",
      borderRadius: 4,
      marginBottom: 12,
      fontWeight: "600",
    }}
  >
    ⚠️ {message}
  </div>
);

const LoadingSkeleton: FC = () => (
  <div
    aria-busy="true"
    aria-label="Loading real-time patient data"
    style={{
      display: "flex",
      gap: "1rem",
      padding: "1rem",
      backgroundColor: "#f0f0f0",
      borderRadius: 4,
    }}
  >
    {[...Array(4)].map((_, i) => (
      <div
        key={i}
        style={{
          backgroundColor: "#ccc",
          height: 60,
          width: 100,
          borderRadius: 4,
          animation: "shimmer 1.5s infinite",
          background:
            "linear-gradient(90deg, #ccc 25%, #e0e0e0 50%, #ccc 75%)",
          backgroundSize: "200% 100%",
          backgroundPosition: "200% center",
        }}
      />
    ))}
    <style>{`
      @keyframes shimmer {
        0% {
          background-position: 200% center;
        }
        100% {
          background-position: -200% center;
        }
      }
    `}</style>
  </div>
);

const ConnectionIndicator: FC<{ status: ConnectionStatus }> = ({ status }) => {
  const colorMap: Record<ConnectionStatus, string> = {
    connected: "#4caf50",
    connecting: "#ff9800",
    offline: "#f44336",
  };
  const textMap: Record<ConnectionStatus, string> = {
    connected: "Connected",
    connecting: "Connecting...",
    offline: "Offline",
  };

  return (
    <div
      aria-live="polite"
      aria-label={`Connection status: ${textMap[status]}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontWeight: 600,
        color: colorMap[status],
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="6" cy="6" r="6" fill={colorMap[status]} />
      </svg>
      <span>{textMap[status]}</span>
    </div>
  );
};

const RealTimeDataPanel: FC<RealTimeDataPanelProps> = ({
  refreshIntervalMs = 5000,
  alertThresholds = defaultAlertThresholds,
  subscribeToPatientData,
}) => {
  const [data, setData] = useState<PatientData | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const dataRef = useRef<PatientData | null>(null);

  const checkAlerts = useCallback(
    (newData: PatientData): string[] => {
      const messages: string[] = [];

      const checkValue = (
        name: keyof PatientData,
        value: number,
        limits?: { min?: number; max?: number }
      ) => {
        if (!limits) return;
        if (limits.min !== undefined && value < limits.min)
          messages.push(
            `${name
              .replace(/([A-Z])/g, " $1")
              .replace(/^./, (str) => str.toUpperCase())} too low (${value})`
          );
        if (limits.max !== undefined && value > limits.max)
          messages.push(
            `${name
              .replace(/([A-Z])/g, " $1")
              .replace(/^./, (str) => str.toUpperCase())} too high (${value})`
          );
      };

      checkValue("heartRate", newData.heartRate, alertThresholds.heartRate);
      checkValue(
        "bloodPressureSystolic",
        newData.bloodPressureSystolic,
        alertThresholds.bloodPressureSystolic
      );
      checkValue(
        "bloodPressureDiastolic",
        newData.bloodPressureDiastolic,
        alertThresholds.bloodPressureDiastolic
      );
      checkValue(
        "oxygenSaturation",
        newData.oxygenSaturation,
        alertThresholds.oxygenSaturation
      );

      return messages;
    },
    [alertThresholds]
  );

  useEffect(() => {
    setConnectionStatus("connecting");
    setIsLoading(true);

    const unsubscribe = subscribeToPatientData(
      (newData) => {
        setData(newData);
        dataRef.current = newData;
        setLastUpdate(new Date());
        setConnectionStatus("connected");
        setIsLoading(false);
        // Only set alerts when data changes to critical values
        const newAlerts = checkAlerts(newData);
        setAlerts(newAlerts);
      },
      () => {
        setConnectionStatus("offline");
        setIsLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [subscribeToPatientData, checkAlerts]);

  // Auto-refresh fallback: if no data update within 2x interval, mark offline.
  useEffect(() => {
    if (connectionStatus !== "connected") return;

    const interval = setInterval(() => {
      if (!lastUpdate) return;
      const elapsed = Date.now() - lastUpdate.getTime();
      if (elapsed > 2 * refreshIntervalMs) {
        setConnectionStatus("offline");
      }
    }, refreshIntervalMs);

    return () => clearInterval(interval);
  }, [lastUpdate, refreshIntervalMs, connectionStatus]);

  const renderDataValue = (
    label: string,
    value: number,
    unit?: string,
    critical?: boolean
  ) => (
    <div
      style={{
        flex: 1,
        minWidth: 110,
        padding: "0.5rem 1rem",
        backgroundColor: critical ? "#ffe6e6" : "#f9f9f9",
        borderRadius: 6,
        boxShadow: critical ? "0 0 10px #f44336aa" : undefined,
        textAlign: "center",
        userSelect: "none",
      }}
    >
      <div
        style={{
          fontSize: 14,
          color: "#555",
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: "700",
          color: critical ? "#d32f2f" : "#222",
          transition: "color 0.25s ease",
        }}
        aria-live="polite"
      >
        {value}
        {unit && <span style={{ fontSize: 14, marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  );

  if (isLoading)
    return (
      <section
        aria-label="Real-time patient data panel loading"
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          maxWidth: 480,
        }}
      >
        <LoadingSkeleton />
      </section>
    );

  if (connectionStatus === "offline")
    return (
      <section
        aria-label="Real-time patient data panel offline"
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          maxWidth: 480,
          textAlign: "center",
          color: "#777",
        }}
      >
        <ConnectionIndicator status="offline" />
        <div style={{ marginTop: 12, fontWeight: 600 }}>
          Real-time data feed is offline.
        </div>
        <div style={{ fontSize: 14, marginTop: 4 }}>
          Please check your network or try refreshing.
        </div>
      </section>
    );

  if (!data)
    return null; // safeguard, shouldn't happen if not loading/offline

  const isCritical = (field: keyof PatientData): boolean => {
    const value = data[field];
    const thresholds = alertThresholds[field];
    if (!thresholds) return false;
    if (
      (thresholds.min !== undefined && value < thresholds.min) ||
      (thresholds.max !== undefined && value > thresholds.max)
    )
      return true;
    return false;
  };

  return (
    <section
      aria-label="Real-time patient data panel"
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 16,
        maxWidth: 480,
        backgroundColor: "#fff",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          userSelect: "none",
        }}
      >
        <h2
          style={{
            fontWeight: 700,
            fontSize: 20,
            margin: 0,
            color: "#222",
          }}
        >
          Real-time Patient Data
        </h2>
        <ConnectionIndicator status={connectionStatus} />
      </header>

      {alerts.length > 0 &&
        alerts.map((msg, idx) => <CriticalAlert key={idx} message={msg} />)}

      <div
        style={{
          display: "flex",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        {renderDataValue(
          "Heart Rate",
          data.heartRate,
          "bpm",
          isCritical("heartRate")
        )}
        {renderDataValue(
          "BP Systolic",
          data.bloodPressureSystolic,
          "mmHg",
          isCritical("bloodPressureSystolic")
        )}
        {renderDataValue(
          "BP Diastolic",
          data.bloodPressureDiastolic,
          "mmHg",
          isCritical("bloodPressureDiastolic")
        )}
        {renderDataValue(
          "Oxygen Sat.",
          data.oxygenSaturation,
          "%",
          isCritical("oxygenSaturation")
        )}
      </div>

      <footer
        style={{
          fontSize: 12,
          color: "#666",
          userSelect: "none",
          textAlign: "right",
        }}
      >
        Last update:{" "}
        {lastUpdate?.toLocaleTimeString(undefined, {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }) ?? "N/A"}
      </footer>
    </section>
  );
};

export default RealTimeDataPanel;
```
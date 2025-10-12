```tsx
import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  KeyboardEvent,
} from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Brush,
} from "recharts";

interface PatientDataPoint {
  timestamp: string; // ISO string
  heartRate: number;
  bloodPressureSystolic: number;
  bloodPressureDiastolic: number;
  oxygenSaturation: number;
}

interface ApiResponse {
  data: PatientDataPoint[];
}

type FetchError = string | null;

const WS_URL = "wss://example.com/patient-stream";

const POLLING_INTERVAL_MS = 15000;

export const ClinicalDataDashboard: React.FC = () => {
  const [patientData, setPatientData] = useState<PatientDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FetchError>(null);
  const [isRealTime, setIsRealTime] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<number | undefined>(undefined);

  const fetchHistoricalData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/patient/historical");
      if (!response.ok) throw new Error("Failed to fetch historical data");
      const json: ApiResponse = await response.json();
      setPatientData(
        json.data.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleWebSocketMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const dataPoint: PatientDataPoint = JSON.parse(event.data);
        setPatientData((prev) => {
          const updated = [...prev, dataPoint];
          if (updated.length > 500) updated.shift(); // keep max 500 points
          return updated;
        });
      } catch {
        // ignore malformed message
      }
    },
    [setPatientData]
  );

  const setupWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setError(null);
    });

    ws.addEventListener("message", handleWebSocketMessage);

    ws.addEventListener("error", () => {
      setError("WebSocket connection error");
    });

    ws.addEventListener("close", () => {
      // Attempt reconnect after delay if real-time is still enabled
      if (isRealTime) {
        setTimeout(() => setupWebSocket(), 5000);
      }
    });
  }, [handleWebSocketMessage, isRealTime]);

  const setupPolling = useCallback(() => {
    pollingRef.current = window.setInterval(() => {
      fetchHistoricalData();
    }, POLLING_INTERVAL_MS);
  }, [fetchHistoricalData]);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    // Initial load:
    fetchHistoricalData();

    if (isRealTime) {
      setupWebSocket();
      clearPolling();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setupPolling();
    }

    return () => {
      if (wsRef.current) wsRef.current.close();
      clearPolling();
    };
  }, [fetchHistoricalData, isRealTime, setupWebSocket, setupPolling, clearPolling]);

  // Keyboard accessibility: allow toggle button toggle via Enter/Space
  const toggleRealTime = useCallback(() => setIsRealTime((v) => !v), []);

  const handleKeyToggle = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleRealTime();
    }
  };

  // Data formatting for tooltips and axis
  const formatTimestamp = (iso: string) => {
    const dt = new Date(iso);
    return dt.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      month: "short",
      day: "numeric",
    });
  };

  // Accessible labels and roles on charts and controls ensured

  return (
    <main
      aria-label="Clinical Data Dashboard"
      className="clinical-dashboard"
      style={{
        fontFamily:
          '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
        padding: "1rem",
        maxWidth: 1200,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      <header>
        <h1 tabIndex={0}>Clinical Data Dashboard</h1>
        <p aria-live="polite" style={{ color: error ? "crimson" : undefined }}>
          {loading && "Loading patient data..."}
          {error && `Error: ${error}`}
          {!loading && !error && `Showing ${patientData.length} data points`}
        </p>
      </header>

      <section
        aria-label="Real-time data controls"
        style={{ display: "flex", gap: "1rem", alignItems: "center" }}
      >
        <button
          type="button"
          onClick={toggleRealTime}
          onKeyDown={handleKeyToggle}
          aria-pressed={isRealTime}
          aria-label={
            isRealTime
              ? "Switch to polling mode for data updates"
              : "Switch to real-time WebSocket data updates"
          }
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 4,
            border: "1px solid #007acc",
            backgroundColor: isRealTime ? "#007acc" : "white",
            color: isRealTime ? "white" : "#007acc",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          {isRealTime ? "Real-Time Mode" : "Polling Mode"}
        </button>

        <button
          type="button"
          onClick={fetchHistoricalData}
          aria-label="Refresh patient data"
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 4,
            border: "1px solid #007acc",
            backgroundColor: "white",
            color: "#007acc",
            cursor: "pointer",
            userSelect: "none",
          }}
          disabled={loading}
        >
          Refresh Data
        </button>
      </section>

      <section
        aria-label="Patient vital signs charts"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: "1rem",
          alignItems: "stretch",
          minHeight: 300,
        }}
      >
        <div
          role="region"
          aria-labelledby="heartRateLabel"
          tabIndex={0}
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            boxShadow:
              "0 2px 6px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h2 id="heartRateLabel">Heart Rate (bpm)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={patientData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTimestamp}
                minTickGap={20}
                aria-label="Time"
                interval="preserveStartEnd"
                height={40}
              />
              <YAxis
                domain={["dataMin - 10", "dataMax + 10"]}
                aria-label="Beats per minute"
              />
              <Tooltip
                labelFormatter={formatTimestamp}
                formatter={(value: number) => [`${value} bpm`, "Heart Rate"]}
              />
              <Legend verticalAlign="top" height={36} />
              <Line
                type="monotone"
                dataKey="heartRate"
                stroke="#e74c3c"
                dot={false}
                isAnimationActive={false}
                name="Heart Rate"
              />
              <Brush
                dataKey="timestamp"
                height={20}
                stroke="#8884d8"
                travellerWidth={10}
                aria-label="Time range selector"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div
          role="region"
          aria-labelledby="bloodPressureLabel"
          tabIndex={0}
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            boxShadow:
              "0 2px 6px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h2 id="bloodPressureLabel">Blood Pressure (mmHg)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={patientData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTimestamp}
                minTickGap={20}
                aria-label="Time"
                interval="preserveStartEnd"
                height={40}
              />
              <YAxis
                domain={[
                  (dataMin: number) => Math.floor(dataMin * 0.75),
                  (dataMax: number) => Math.ceil(dataMax * 1.25),
                ]}
                aria-label="Millimeters of mercury"
              />
              <Tooltip
                labelFormatter={formatTimestamp}
                formatter={(value: number, name: string) =>
                  [`${value} mmHg`, name]
                }
              />
              <Legend verticalAlign="top" height={36} />
              <Line
                type="monotone"
                dataKey="bloodPressureSystolic"
                stroke="#2980b9"
                dot={false}
                isAnimationActive={false}
                name="Systolic"
              />
              <Line
                type="monotone"
                dataKey="bloodPressureDiastolic"
                stroke="#3498db"
                dot={false}
                isAnimationActive={false}
                name="Diastolic"
              />
              <Brush
                dataKey="timestamp"
                height={20}
                stroke="#8884d8"
                travellerWidth={10}
                aria-label="Time range selector"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div
          role="region"
          aria-labelledby="oxygenSaturationLabel"
          tabIndex={0}
          style={{
            backgroundColor: "white",
            borderRadius: 8,
            boxShadow:
              "0 2px 6px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h2 id="oxygenSaturationLabel">Oxygen Saturation (%)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={patientData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTimestamp}
                minTickGap={20}
                aria-label="Time"
                interval="preserveStartEnd"
                height={40}
              />
              <YAxis domain={[85, 100]} aria-label="Percent saturation" />
              <Tooltip
                labelFormatter={formatTimestamp}
                formatter={(value: number) => [`${value} %`, "Oxygen Saturation"]}
              />
              <Legend verticalAlign="top" height={36} />
              <Line
                type="monotone"
                dataKey="oxygenSaturation"
                stroke="#27ae60"
                dot={false}
                isAnimationActive={false}
                name="Oxygen Saturation"
              />
              <Brush
                dataKey="timestamp"
                height={20}
                stroke="#8884d8"
                travellerWidth={10}
                aria-label="Time range selector"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
};

export default ClinicalDataDashboard;
```
